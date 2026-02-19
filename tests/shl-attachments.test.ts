import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SHL } from "../src/index.js";

describe("SHL attachments (multi-file support)", () => {
  let tempDir: string;
  let storage: InstanceType<typeof SHL.LocalStorage>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "shl-attach-"));
    storage = new SHL.LocalStorage({
      directory: tempDir,
      baseUrl: "https://shl.example.com",
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const minimalBundle = {
    resourceType: "Bundle",
    type: "document",
    entry: [],
  };

  it("creates an SHL with no attachments (backwards compatible)", async () => {
    const result = await SHL.create({ bundle: minimalBundle, storage });
    const manifest = JSON.parse(
      readFileSync(join(tempDir, result.id, "manifest.json"), "utf8"),
    );
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0].contentType).toBe("application/fhir+json;fhirVersion=4.0.1");
  });

  it("creates an SHL with a PDF attachment", async () => {
    const pdfContent = Buffer.from("%PDF-1.4 fake pdf content");
    const result = await SHL.create({
      bundle: minimalBundle,
      storage,
      attachments: [
        { contentType: "application/pdf", content: pdfContent },
      ],
    });

    const manifest = JSON.parse(
      readFileSync(join(tempDir, result.id, "manifest.json"), "utf8"),
    );

    expect(manifest.files).toHaveLength(2);
    expect(manifest.files[0].contentType).toBe("application/fhir+json;fhirVersion=4.0.1");
    expect(manifest.files[1].contentType).toBe("application/pdf");
    expect(manifest.files[1].location).toContain("/attachment/0");

    // Verify the JWE file was stored
    expect(existsSync(join(tempDir, result.id, "attachment-0.jwe"))).toBe(true);
  });

  it("creates an SHL with multiple attachments", async () => {
    const result = await SHL.create({
      bundle: minimalBundle,
      storage,
      attachments: [
        { contentType: "application/pdf", content: Buffer.from("pdf-1") },
        { contentType: "application/pdf", content: Buffer.from("pdf-2") },
        { contentType: "text/plain", content: "plain text note" },
      ],
    });

    const manifest = JSON.parse(
      readFileSync(join(tempDir, result.id, "manifest.json"), "utf8"),
    );

    expect(manifest.files).toHaveLength(4);
    expect(manifest.files[1].location).toContain("/attachment/0");
    expect(manifest.files[2].location).toContain("/attachment/1");
    expect(manifest.files[3].contentType).toBe("text/plain");
    expect(manifest.files[3].location).toContain("/attachment/2");

    expect(existsSync(join(tempDir, result.id, "attachment-0.jwe"))).toBe(true);
    expect(existsSync(join(tempDir, result.id, "attachment-1.jwe"))).toBe(true);
    expect(existsSync(join(tempDir, result.id, "attachment-2.jwe"))).toBe(true);
  });

  it("round-trips a PDF attachment through encrypt/decrypt", async () => {
    const pdfContent = Buffer.from("%PDF-1.4 test round-trip content here");
    const result = await SHL.create({
      bundle: minimalBundle,
      storage,
      attachments: [
        { contentType: "application/pdf", content: pdfContent },
      ],
    });

    // Decode the SHL URL to get the key
    const decoded = SHL.decode(result.url);

    // Read the encrypted attachment
    const jwe = readFileSync(
      join(tempDir, result.id, "attachment-0.jwe"),
      "utf8",
    );

    // Decrypt using decryptContent
    const decrypted = SHL.decryptContent(jwe, decoded.key);
    expect(decrypted.contentType).toBe("application/pdf");
    expect(Buffer.from(decrypted.data).toString()).toBe(
      "%PDF-1.4 test round-trip content here",
    );
  });

  it("round-trips a text attachment through encrypt/decrypt", async () => {
    const textContent = "Patient notes: stable condition, follow up in 2 weeks";
    const result = await SHL.create({
      bundle: minimalBundle,
      storage,
      attachments: [
        { contentType: "text/plain", content: textContent },
      ],
    });

    const decoded = SHL.decode(result.url);
    const jwe = readFileSync(
      join(tempDir, result.id, "attachment-0.jwe"),
      "utf8",
    );
    const decrypted = SHL.decryptContent(jwe, decoded.key);
    expect(decrypted.contentType).toBe("text/plain");
    expect(decrypted.data.toString("utf8")).toBe(textContent);
  });

  it("main FHIR bundle is still decryptable with SHL.decrypt()", async () => {
    const result = await SHL.create({
      bundle: minimalBundle,
      storage,
      attachments: [
        { contentType: "application/pdf", content: Buffer.from("pdf") },
      ],
    });

    const decoded = SHL.decode(result.url);
    const jwe = readFileSync(
      join(tempDir, result.id, "content.jwe"),
      "utf8",
    );
    const bundle = SHL.decrypt(jwe, decoded.key);
    expect(bundle.resourceType).toBe("Bundle");
    expect(bundle.type).toBe("document");
  });
});

describe("SHL server — attachment routes", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "shl-srv-attach-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("serves attachment content via GET /{shlId}/attachment/{index}", async () => {
    // We need to use the server handler directly
    const { createHandler } = await import("../src/server/handler.js");
    const { ServerLocalStorage } = await import("../src/server/storage.js");

    const storage = new SHL.LocalStorage({
      directory: tempDir,
      baseUrl: "http://localhost:3000/shl",
    });

    // Create SHL with an attachment
    const result = await SHL.create({
      bundle: { resourceType: "Bundle", type: "document", entry: [] },
      storage,
      attachments: [
        { contentType: "application/pdf", content: Buffer.from("pdf-data") },
      ],
    });

    // Set up server storage
    const serverStorage = new ServerLocalStorage({
      directory: tempDir,
      baseUrl: "http://localhost:3000/shl",
    });
    const handle = createHandler({ storage: serverStorage });

    // Request the attachment
    const response = await handle({
      method: "GET",
      path: `/${result.id}/attachment/0`,
      headers: {},
    });

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("application/jose");
    expect(typeof response.body).toBe("string");
    // The body is a JWE — verify it has 5 parts
    expect((response.body as string).split(".")).toHaveLength(5);
  });

  it("returns 404 for non-existent attachment index", async () => {
    const { createHandler } = await import("../src/server/handler.js");
    const { ServerLocalStorage } = await import("../src/server/storage.js");

    const storage = new SHL.LocalStorage({
      directory: tempDir,
      baseUrl: "http://localhost:3000/shl",
    });

    const result = await SHL.create({
      bundle: { resourceType: "Bundle", type: "document", entry: [] },
      storage,
    });

    const serverStorage = new ServerLocalStorage({
      directory: tempDir,
      baseUrl: "http://localhost:3000/shl",
    });
    const handle = createHandler({ storage: serverStorage });

    const response = await handle({
      method: "GET",
      path: `/${result.id}/attachment/0`,
      headers: {},
    });

    expect(response.status).toBe(404);
  });

  it("returns 400 for invalid attachment index", async () => {
    const { createHandler } = await import("../src/server/handler.js");
    const { ServerLocalStorage } = await import("../src/server/storage.js");

    const serverStorage = new ServerLocalStorage({
      directory: tempDir,
      baseUrl: "http://localhost:3000/shl",
    });
    const handle = createHandler({ storage: serverStorage });

    const response = await handle({
      method: "GET",
      path: `/some-id/attachment/abc`,
      headers: {},
    });

    expect(response.status).toBe(400);
  });
});
