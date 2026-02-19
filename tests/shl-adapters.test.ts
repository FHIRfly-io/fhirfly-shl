import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { expressMiddleware } from "../src/adapters/express.js";
import { fastifyPlugin } from "../src/adapters/fastify.js";
import { lambdaHandler } from "../src/adapters/lambda.js";
import type { SHLServerStorage } from "../src/server/types.js";
import type { SHLMetadata, Manifest } from "../src/shl/types.js";

/** Hash a passcode with SHA-256 (matches create.ts storage format). */
function hashPasscode(passcode: string): string {
  return createHash("sha256").update(passcode).digest("hex");
}

/** In-memory mock server storage. */
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

function seedStorage(storage: MockServerStorage, shlId: string, metadata: SHLMetadata): void {
  storage.files.set(`${shlId}/metadata.json`, JSON.stringify(metadata));
  storage.files.set(`${shlId}/manifest.json`, JSON.stringify({
    files: [
      { contentType: "application/fhir+json", location: `${storage.baseUrl}/${shlId}/content` },
      { contentType: "application/pdf", location: `${storage.baseUrl}/${shlId}/attachment/0` },
    ],
  }));
  storage.files.set(`${shlId}/content.jwe`, "test-jwe-content");
  storage.files.set(`${shlId}/attachment-0.jwe`, "test-attachment-content");
}

// ─────────────────────────────────────────────
// Express adapter tests (using mock req/res objects)
// ─────────────────────────────────────────────

describe("expressMiddleware", () => {
  it("handles POST /{shlId} manifest request", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-1", { createdAt: new Date().toISOString() });
    const mw = expressMiddleware({ storage });

    const req = {
      method: "POST",
      path: "/shl-1",
      body: {},
      headers: { "content-type": "application/json" },
    };

    let statusCode = 0;
    let sentBody = "";
    let sentHeaders: Record<string, string> = {};
    const res = {
      status(code: number) { statusCode = code; return res; },
      set(headers: Record<string, string>) { sentHeaders = headers; return res; },
      send(body: string) { sentBody = body; },
    };

    mw(req, res);
    // Wait for async handler to complete
    await new Promise((r) => setTimeout(r, 50));

    expect(statusCode).toBe(200);
    expect(sentHeaders["content-type"]).toBe("application/json");
    const manifest = JSON.parse(sentBody) as Manifest;
    expect(manifest.files).toHaveLength(2);
  });

  it("handles GET /{shlId}/content request", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-1", { createdAt: new Date().toISOString() });
    const mw = expressMiddleware({ storage });

    const req = {
      method: "GET",
      path: "/shl-1/content",
      headers: {},
    };

    let statusCode = 0;
    let sentBody: string | Buffer = "";
    let sentHeaders: Record<string, string> = {};
    const res = {
      status(code: number) { statusCode = code; return res; },
      set(headers: Record<string, string>) { sentHeaders = headers; return res; },
      send(body: string | Buffer) { sentBody = body; },
    };

    mw(req, res);
    await new Promise((r) => setTimeout(r, 50));

    expect(statusCode).toBe(200);
    expect(sentHeaders["content-type"]).toBe("application/jose");
    expect(sentBody).toBe("test-jwe-content");
  });

  it("handles GET /{shlId}/attachment/{index} request", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-1", { createdAt: new Date().toISOString() });
    const mw = expressMiddleware({ storage });

    const req = {
      method: "GET",
      path: "/shl-1/attachment/0",
      headers: {},
    };

    let statusCode = 0;
    let sentBody: string | Buffer = "";
    let sentHeaders: Record<string, string> = {};
    const res = {
      status(code: number) { statusCode = code; return res; },
      set(headers: Record<string, string>) { sentHeaders = headers; return res; },
      send(body: string | Buffer) { sentBody = body; },
    };

    mw(req, res);
    await new Promise((r) => setTimeout(r, 50));

    expect(statusCode).toBe(200);
    expect(sentHeaders["content-type"]).toBe("application/jose");
    expect(sentBody).toBe("test-attachment-content");
  });

  it("returns 401 for missing passcode", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-pass", {
      createdAt: new Date().toISOString(),
      passcode: hashPasscode("secret"),
    });
    const mw = expressMiddleware({ storage });

    const req = {
      method: "POST",
      path: "/shl-pass",
      body: {},
      headers: { "content-type": "application/json" },
    };

    let statusCode = 0;
    const res = {
      status(code: number) { statusCode = code; return res; },
      set() { return res; },
      send() {},
    };

    mw(req, res);
    await new Promise((r) => setTimeout(r, 50));

    expect(statusCode).toBe(401);
  });
});

// ─────────────────────────────────────────────
// Fastify adapter tests (using mock fastify instance)
// ─────────────────────────────────────────────

describe("fastifyPlugin", () => {
  it("registers POST /:shlId, GET /:shlId/content, and GET /:shlId/attachment/:index routes", () => {
    const storage = new MockServerStorage();
    const plugin = fastifyPlugin({ storage });

    const registeredRoutes: string[] = [];
    const mockFastify = {
      post(path: string) { registeredRoutes.push(`POST ${path}`); },
      get(path: string) { registeredRoutes.push(`GET ${path}`); },
    };

    const done = vi.fn();
    plugin(mockFastify as never, {}, done);

    expect(registeredRoutes).toContain("POST /:shlId");
    expect(registeredRoutes).toContain("GET /:shlId/content");
    expect(registeredRoutes).toContain("GET /:shlId/attachment/:index");
    expect(done).toHaveBeenCalledOnce();
  });

  it("POST handler returns manifest for valid SHL", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-1", { createdAt: new Date().toISOString() });
    const plugin = fastifyPlugin({ storage });

    // Capture the POST handler
    let postHandler: ((req: unknown, reply: unknown) => Promise<void>) | undefined;
    const mockFastify = {
      post(_path: string, handler: (req: unknown, reply: unknown) => Promise<void>) {
        postHandler = handler;
      },
      get() {},
    };

    plugin(mockFastify as never, {}, () => {});

    // Simulate a request
    const req = {
      params: { shlId: "shl-1" },
      body: {},
      headers: { "content-type": "application/json" },
    };

    let statusCode = 0;
    let sentBody: string | Buffer = "";
    let sentHeaders: Record<string, string> = {};
    const reply = {
      status(code: number) { statusCode = code; return reply; },
      headers(h: Record<string, string>) { sentHeaders = h; return reply; },
      send(body: string | Buffer) { sentBody = body; },
    };

    await postHandler!(req, reply);

    expect(statusCode).toBe(200);
    expect(sentHeaders["content-type"]).toBe("application/json");
    const manifest = JSON.parse(sentBody as string) as Manifest;
    expect(manifest.files).toHaveLength(2);
  });

  it("GET handler returns content for valid SHL", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-1", { createdAt: new Date().toISOString() });
    const plugin = fastifyPlugin({ storage });

    const getHandlers = new Map<string, (req: unknown, reply: unknown) => Promise<void>>();
    const mockFastify = {
      post() {},
      get(path: string, handler: (req: unknown, reply: unknown) => Promise<void>) {
        getHandlers.set(path, handler);
      },
    };

    plugin(mockFastify as never, {}, () => {});

    const req = {
      params: { shlId: "shl-1" },
      headers: {},
    };

    let statusCode = 0;
    let sentBody: string | Buffer = "";
    let sentHeaders: Record<string, string> = {};
    const reply = {
      status(code: number) { statusCode = code; return reply; },
      headers(h: Record<string, string>) { sentHeaders = h; return reply; },
      send(body: string | Buffer) { sentBody = body; },
    };

    const contentHandler = getHandlers.get("/:shlId/content")!;
    await contentHandler(req, reply);

    expect(statusCode).toBe(200);
    expect(sentHeaders["content-type"]).toBe("application/jose");
    expect(sentBody).toBe("test-jwe-content");
  });

  it("GET handler returns attachment for valid SHL", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-1", { createdAt: new Date().toISOString() });
    const plugin = fastifyPlugin({ storage });

    const getHandlers = new Map<string, (req: unknown, reply: unknown) => Promise<void>>();
    const mockFastify = {
      post() {},
      get(path: string, handler: (req: unknown, reply: unknown) => Promise<void>) {
        getHandlers.set(path, handler);
      },
    };

    plugin(mockFastify as never, {}, () => {});

    const req = {
      params: { shlId: "shl-1", index: "0" },
      headers: {},
    };

    let statusCode = 0;
    let sentBody: string | Buffer = "";
    let sentHeaders: Record<string, string> = {};
    const reply = {
      status(code: number) { statusCode = code; return reply; },
      headers(h: Record<string, string>) { sentHeaders = h; return reply; },
      send(body: string | Buffer) { sentBody = body; },
    };

    const attachmentHandler = getHandlers.get("/:shlId/attachment/:index")!;
    await attachmentHandler(req, reply);

    expect(statusCode).toBe(200);
    expect(sentHeaders["content-type"]).toBe("application/jose");
    expect(sentBody).toBe("test-attachment-content");
  });
});

// ─────────────────────────────────────────────
// Lambda adapter tests
// ─────────────────────────────────────────────

describe("lambdaHandler", () => {
  it("handles POST manifest request", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-1", { createdAt: new Date().toISOString() });
    const handler = lambdaHandler({ storage, pathPrefix: "/shl" });

    const event = {
      requestContext: { http: { method: "POST", path: "/shl/shl-1" } },
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(result.headers["content-type"]).toBe("application/json");
    const manifest = JSON.parse(result.body) as Manifest;
    expect(manifest.files).toHaveLength(2);
  });

  it("handles GET content request", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-1", { createdAt: new Date().toISOString() });
    const handler = lambdaHandler({ storage, pathPrefix: "/shl" });

    const event = {
      requestContext: { http: { method: "GET", path: "/shl/shl-1/content" } },
      headers: {},
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(result.headers["content-type"]).toBe("application/jose");
    expect(result.body).toBe("test-jwe-content");
  });

  it("handles GET attachment request", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-1", { createdAt: new Date().toISOString() });
    const handler = lambdaHandler({ storage, pathPrefix: "/shl" });

    const event = {
      requestContext: { http: { method: "GET", path: "/shl/shl-1/attachment/0" } },
      headers: {},
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(200);
    expect(result.headers["content-type"]).toBe("application/jose");
    expect(result.body).toBe("test-attachment-content");
  });

  it("strips pathPrefix from event path", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-1", { createdAt: new Date().toISOString() });
    const handler = lambdaHandler({ storage, pathPrefix: "/api/v1/shl" });

    const event = {
      requestContext: { http: { method: "POST", path: "/api/v1/shl/shl-1" } },
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    };

    const result = await handler(event);
    expect(result.statusCode).toBe(200);
  });

  it("works without pathPrefix", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-1", { createdAt: new Date().toISOString() });
    const handler = lambdaHandler({ storage });

    const event = {
      requestContext: { http: { method: "POST", path: "/shl-1" } },
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    };

    const result = await handler(event);
    expect(result.statusCode).toBe(200);
  });

  it("handles base64-encoded body", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-pass", {
      createdAt: new Date().toISOString(),
      passcode: hashPasscode("1234"),
    });
    const handler = lambdaHandler({ storage, pathPrefix: "/shl" });

    const event = {
      requestContext: { http: { method: "POST", path: "/shl/shl-pass" } },
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({ passcode: "1234" })).toString("base64"),
      isBase64Encoded: true,
    };

    const result = await handler(event);
    expect(result.statusCode).toBe(200);
  });

  it("returns 401 for wrong passcode", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-pass", {
      createdAt: new Date().toISOString(),
      passcode: hashPasscode("correct"),
    });
    const handler = lambdaHandler({ storage, pathPrefix: "/shl" });

    const event = {
      requestContext: { http: { method: "POST", path: "/shl/shl-pass" } },
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: "wrong" }),
    };

    const result = await handler(event);
    expect(result.statusCode).toBe(401);
  });

  it("returns 404 for unknown SHL", async () => {
    const storage = new MockServerStorage();
    const handler = lambdaHandler({ storage, pathPrefix: "/shl" });

    const event = {
      requestContext: { http: { method: "POST", path: "/shl/nonexistent" } },
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    };

    const result = await handler(event);
    expect(result.statusCode).toBe(404);
  });

  it("handles missing body gracefully", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-1", { createdAt: new Date().toISOString() });
    const handler = lambdaHandler({ storage, pathPrefix: "/shl" });

    const event = {
      requestContext: { http: { method: "POST", path: "/shl/shl-1" } },
      headers: {},
    };

    const result = await handler(event);
    expect(result.statusCode).toBe(200);
  });
});
