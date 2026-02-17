import { describe, it, expect } from "vitest";
import { IPS, SHL } from "../src/index.js";
import { createHandler } from "../src/server/handler.js";
import { ServerLocalStorage } from "../src/server/storage.js";
import type { SHLServerStorage, HandlerRequest } from "../src/server/types.js";
import type { SHLMetadata, Manifest } from "../src/shl/types.js";
import { tmpdir } from "node:os";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

/** In-memory mock server storage for pure handler tests. */
class MockServerStorage implements SHLServerStorage {
  readonly baseUrl = "https://shl.example.com";
  readonly files = new Map<string, string | Uint8Array>();

  async store(key: string, content: string | Uint8Array): Promise<void> {
    this.files.set(key, content);
  }
  async delete(prefix: string): Promise<void> {
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) this.files.delete(key);
    }
  }
  async read(key: string): Promise<string | Uint8Array | null> {
    return this.files.get(key) ?? null;
  }
  async updateMetadata(
    shlId: string,
    updater: (current: SHLMetadata) => SHLMetadata | null,
  ): Promise<SHLMetadata | null> {
    const key = `${shlId}/metadata.json`;
    const raw = this.files.get(key);
    if (raw === undefined) return null;
    const current = JSON.parse(raw as string) as SHLMetadata;
    const updated = updater(current);
    if (updated === null) return null;
    this.files.set(key, JSON.stringify(updated));
    return updated;
  }
}

describe("End-to-end: IPS.Bundle → SHL.create → server handler → SHL.decode/decrypt", () => {
  it("round-trips a full IPS bundle through create → serve → decode → decrypt", async () => {
    // 1. Build an IPS bundle
    const bundle = new IPS.Bundle({
      given: "Jane",
      family: "Doe",
      birthDate: "1990-01-15",
      gender: "female",
    });
    bundle.addMedication({
      code: "860975",
      system: "http://www.nlm.nih.gov/research/umls/rxnorm",
      display: "Metformin 500 MG Oral Tablet",
    });
    bundle.addCondition({
      code: "44054006",
      system: "http://snomed.info/sct",
      display: "Type 2 diabetes mellitus",
    });
    const fhirBundle = await bundle.build();

    // 2. Create SHL with mock server storage
    const storage = new MockServerStorage();
    const shlResult = await SHL.create({
      bundle: fhirBundle,
      passcode: "1234",
      expiresAt: new Date("2099-12-31"),
      maxAccesses: 10,
      label: "Jane Doe's IPS",
      storage,
    });

    expect(shlResult.url).toMatch(/^shlink:\//);
    expect(shlResult.id).toBeDefined();
    expect(shlResult.passcode).toBe("1234");

    // 3. Set up server handler
    const handler = createHandler({ storage });

    // 4. POST manifest (simulating SHL consumer)
    const decoded = SHL.decode(shlResult.url);
    expect(decoded.url).toBe(`${storage.baseUrl}/${shlResult.id}`);
    expect(decoded.flag).toBe("LP");
    expect(decoded.label).toBe("Jane Doe's IPS");

    const manifestReq: HandlerRequest = {
      method: "POST",
      path: `/${shlResult.id}`,
      body: { passcode: "1234" },
      headers: { "content-type": "application/json" },
    };
    const manifestRes = await handler(manifestReq);
    expect(manifestRes.status).toBe(200);

    const manifest = JSON.parse(manifestRes.body as string) as Manifest;
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0]!.contentType).toBe("application/fhir+json");

    // 5. GET content (from manifest location)
    const contentReq: HandlerRequest = {
      method: "GET",
      path: `/${shlResult.id}/content`,
      headers: {},
    };
    const contentRes = await handler(contentReq);
    expect(contentRes.status).toBe(200);
    expect(contentRes.headers["content-type"]).toBe("application/jose");

    // 6. Decrypt and verify
    const decrypted = SHL.decrypt(contentRes.body as string, decoded.key);
    expect(decrypted["resourceType"]).toBe("Bundle");
    expect(decrypted["type"]).toBe("document");

    // Verify patient is present
    const entries = (decrypted["entry"] as Array<{ resource: Record<string, unknown> }>);
    const patient = entries.find(e => e.resource["resourceType"] === "Patient");
    expect(patient).toBeDefined();
    const patientNames = patient!.resource["name"] as Array<{ family: string; given: string[] }>;
    expect(patientNames[0]!.family).toBe("Doe");
    expect(patientNames[0]!.given).toContain("Jane");

    // Verify medication is present
    const medicationStatement = entries.find(
      e => e.resource["resourceType"] === "MedicationStatement",
    );
    expect(medicationStatement).toBeDefined();
  });

  it("enforces passcode on manifest request", async () => {
    const bundle = new IPS.Bundle({
      given: "Test",
      family: "User",
      birthDate: "2000-01-01",
      gender: "male",
    });
    const fhirBundle = await bundle.build();

    const storage = new MockServerStorage();
    const shlResult = await SHL.create({
      bundle: fhirBundle,
      passcode: "secure123",
      storage,
    });

    const handler = createHandler({ storage });

    // No passcode → 401
    const res1 = await handler({
      method: "POST",
      path: `/${shlResult.id}`,
      body: {},
      headers: { "content-type": "application/json" },
    });
    expect(res1.status).toBe(401);

    // Wrong passcode → 401
    const res2 = await handler({
      method: "POST",
      path: `/${shlResult.id}`,
      body: { passcode: "wrong" },
      headers: { "content-type": "application/json" },
    });
    expect(res2.status).toBe(401);

    // Correct passcode → 200
    const res3 = await handler({
      method: "POST",
      path: `/${shlResult.id}`,
      body: { passcode: "secure123" },
      headers: { "content-type": "application/json" },
    });
    expect(res3.status).toBe(200);
  });

  it("enforces access count limit", async () => {
    const bundle = new IPS.Bundle({
      given: "Test",
      family: "Limited",
      birthDate: "2000-01-01",
      gender: "female",
    });
    const fhirBundle = await bundle.build();

    const storage = new MockServerStorage();
    const shlResult = await SHL.create({
      bundle: fhirBundle,
      maxAccesses: 2,
      storage,
    });

    const handler = createHandler({ storage });

    const req: HandlerRequest = {
      method: "POST",
      path: `/${shlResult.id}`,
      body: {},
      headers: { "content-type": "application/json" },
    };

    // Access 1 → OK
    expect((await handler(req)).status).toBe(200);
    // Access 2 → OK
    expect((await handler(req)).status).toBe(200);
    // Access 3 → 410 (limit reached)
    expect((await handler(req)).status).toBe(410);
  });
});

describe("End-to-end: ServerLocalStorage with filesystem", () => {
  it("create → serve from filesystem → decode → decrypt", async () => {
    // Create temp directory
    const tmpDir = mkdtempSync(join(tmpdir(), "shl-test-"));

    try {
      const storage = new ServerLocalStorage({
        directory: tmpDir,
        baseUrl: "https://shl.example.com",
      });

      // Create a simple bundle
      const bundle = new IPS.Bundle({
        given: "Alice",
        family: "Smith",
        birthDate: "1985-06-15",
        gender: "female",
      });
      const fhirBundle = await bundle.build();

      // Create SHL
      const shlResult = await SHL.create({
        bundle: fhirBundle,
        storage,
      });

      // Create handler with same storage
      const handler = createHandler({ storage });

      // POST manifest
      const manifestRes = await handler({
        method: "POST",
        path: `/${shlResult.id}`,
        body: {},
        headers: { "content-type": "application/json" },
      });
      expect(manifestRes.status).toBe(200);

      // GET content from filesystem
      const contentRes = await handler({
        method: "GET",
        path: `/${shlResult.id}/content`,
        headers: {},
      });
      expect(contentRes.status).toBe(200);

      // Decode and decrypt
      const decoded = SHL.decode(shlResult.url);
      const decrypted = SHL.decrypt(contentRes.body as string, decoded.key);
      expect(decrypted["resourceType"]).toBe("Bundle");
      expect(decrypted["type"]).toBe("document");

      // Verify patient data survives round-trip
      const entries = (decrypted["entry"] as Array<{ resource: Record<string, unknown> }>);
      const patient = entries.find(e => e.resource["resourceType"] === "Patient");
      expect(patient).toBeDefined();
    } finally {
      // Cleanup
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
