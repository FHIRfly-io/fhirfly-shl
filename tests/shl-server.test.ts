import { describe, it, expect, vi } from "vitest";
import { createHandler } from "../src/server/handler.js";
import type { SHLServerStorage, HandlerRequest } from "../src/server/types.js";
import type { SHLMetadata, Manifest } from "../src/shl/types.js";

/** In-memory mock server storage for tests. */
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

/** Helper to seed a mock storage with SHL files. */
function seedStorage(
  storage: MockServerStorage,
  shlId: string,
  metadata: SHLMetadata,
  manifest?: Manifest,
  content?: string,
): void {
  storage.files.set(
    `${shlId}/metadata.json`,
    JSON.stringify(metadata),
  );
  storage.files.set(
    `${shlId}/manifest.json`,
    JSON.stringify(manifest ?? {
      files: [{ contentType: "application/fhir+json", location: `${storage.baseUrl}/${shlId}/content` }],
    }),
  );
  storage.files.set(
    `${shlId}/content.jwe`,
    content ?? "header..iv.ciphertext.tag",
  );
}

function makeRequest(overrides: Partial<HandlerRequest> = {}): HandlerRequest {
  return {
    method: "POST",
    path: "/test-shl-id",
    headers: { "content-type": "application/json" },
    ...overrides,
  };
}

describe("createHandler — manifest endpoint (POST /{shlId})", () => {
  it("returns manifest for valid SHL without passcode", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-1", { createdAt: new Date().toISOString() });
    const handler = createHandler({ storage });

    const res = await handler(makeRequest({ path: "/shl-1" }));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/json");

    const body = JSON.parse(res.body as string) as Manifest;
    expect(body.files).toHaveLength(1);
    expect(body.files[0]!.contentType).toBe("application/fhir+json");
  });

  it("increments accessCount on each access", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-1", { createdAt: new Date().toISOString() });
    const handler = createHandler({ storage });

    await handler(makeRequest({ path: "/shl-1" }));
    await handler(makeRequest({ path: "/shl-1" }));
    await handler(makeRequest({ path: "/shl-1" }));

    const metadata = JSON.parse(storage.files.get("shl-1/metadata.json") as string) as SHLMetadata;
    expect(metadata.accessCount).toBe(3);
  });

  it("returns 404 for unknown SHL", async () => {
    const storage = new MockServerStorage();
    const handler = createHandler({ storage });

    const res = await handler(makeRequest({ path: "/nonexistent" }));
    expect(res.status).toBe(404);
  });

  it("returns 410 for expired SHL", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-expired", {
      createdAt: new Date().toISOString(),
      expiresAt: new Date("2020-01-01").toISOString(),
    });
    const handler = createHandler({ storage });

    const res = await handler(makeRequest({ path: "/shl-expired" }));
    expect(res.status).toBe(410);
    expect(JSON.parse(res.body as string)).toMatchObject({ error: expect.stringContaining("expired") });
  });

  it("returns 200 for non-expired SHL", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-future", {
      createdAt: new Date().toISOString(),
      expiresAt: new Date("2099-01-01").toISOString(),
    });
    const handler = createHandler({ storage });

    const res = await handler(makeRequest({ path: "/shl-future" }));
    expect(res.status).toBe(200);
  });

  it("returns 410 when access limit reached", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-limited", {
      createdAt: new Date().toISOString(),
      maxAccesses: 2,
      accessCount: 0,
    });
    const handler = createHandler({ storage });

    // First two accesses succeed
    expect((await handler(makeRequest({ path: "/shl-limited" }))).status).toBe(200);
    expect((await handler(makeRequest({ path: "/shl-limited" }))).status).toBe(200);

    // Third access → 410
    const res = await handler(makeRequest({ path: "/shl-limited" }));
    expect(res.status).toBe(410);
    expect(JSON.parse(res.body as string)).toMatchObject({ error: expect.stringContaining("limit") });
  });

  it("maxAccesses: 1 allows exactly one access", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-once", {
      createdAt: new Date().toISOString(),
      maxAccesses: 1,
    });
    const handler = createHandler({ storage });

    expect((await handler(makeRequest({ path: "/shl-once" }))).status).toBe(200);
    expect((await handler(makeRequest({ path: "/shl-once" }))).status).toBe(410);
  });
});

describe("createHandler — passcode validation", () => {
  it("returns 401 when passcode required but not provided", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-pass", {
      createdAt: new Date().toISOString(),
      passcode: "secret",
    });
    const handler = createHandler({ storage });

    const res = await handler(makeRequest({ path: "/shl-pass" }));
    expect(res.status).toBe(401);
  });

  it("returns 401 when wrong passcode provided", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-pass", {
      createdAt: new Date().toISOString(),
      passcode: "secret",
    });
    const handler = createHandler({ storage });

    const res = await handler(makeRequest({
      path: "/shl-pass",
      body: { passcode: "wrong" },
    }));
    expect(res.status).toBe(401);
  });

  it("returns 200 when correct passcode provided", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-pass", {
      createdAt: new Date().toISOString(),
      passcode: "secret",
    });
    const handler = createHandler({ storage });

    const res = await handler(makeRequest({
      path: "/shl-pass",
      body: { passcode: "secret" },
    }));
    expect(res.status).toBe(200);
  });

  it("passcode check happens after expiration check", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-expired-pass", {
      createdAt: new Date().toISOString(),
      passcode: "secret",
      expiresAt: new Date("2020-01-01").toISOString(),
    });
    const handler = createHandler({ storage });

    // Even with correct passcode, expired link returns 410
    const res = await handler(makeRequest({
      path: "/shl-expired-pass",
      body: { passcode: "secret" },
    }));
    expect(res.status).toBe(410);
  });
});

describe("createHandler — content endpoint (GET /{shlId}/content)", () => {
  it("returns content with application/jose content type", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-1", {
      createdAt: new Date().toISOString(),
    }, undefined, "encrypted-jwe-content");
    const handler = createHandler({ storage });

    const res = await handler(makeRequest({
      method: "GET",
      path: "/shl-1/content",
    }));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/jose");
    expect(res.body).toBe("encrypted-jwe-content");
  });

  it("returns 404 for unknown SHL content", async () => {
    const storage = new MockServerStorage();
    const handler = createHandler({ storage });

    const res = await handler(makeRequest({
      method: "GET",
      path: "/nonexistent/content",
    }));
    expect(res.status).toBe(404);
  });

  it("sets cache-control: no-store", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-1", { createdAt: new Date().toISOString() });
    const handler = createHandler({ storage });

    const res = await handler(makeRequest({
      method: "GET",
      path: "/shl-1/content",
    }));
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("createHandler — HTTP method enforcement", () => {
  it("returns 405 for GET on manifest path", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-1", { createdAt: new Date().toISOString() });
    const handler = createHandler({ storage });

    const res = await handler(makeRequest({
      method: "GET",
      path: "/shl-1",
    }));
    expect(res.status).toBe(405);
  });

  it("returns 405 for POST on content path", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-1", { createdAt: new Date().toISOString() });
    const handler = createHandler({ storage });

    const res = await handler(makeRequest({
      method: "POST",
      path: "/shl-1/content",
    }));
    expect(res.status).toBe(405);
  });

  it("returns 404 for unknown paths", async () => {
    const storage = new MockServerStorage();
    const handler = createHandler({ storage });

    const res = await handler(makeRequest({
      method: "GET",
      path: "/shl-1/something/else",
    }));
    expect(res.status).toBe(404);
  });
});

describe("createHandler — onAccess callback", () => {
  it("calls onAccess with correct event after successful manifest access", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-1", { createdAt: new Date().toISOString() });
    const onAccess = vi.fn();
    const handler = createHandler({ storage, onAccess });

    await handler(makeRequest({ path: "/shl-1" }));

    expect(onAccess).toHaveBeenCalledOnce();
    expect(onAccess).toHaveBeenCalledWith(expect.objectContaining({
      shlId: "shl-1",
      accessCount: 1,
      timestamp: expect.any(Date),
    }));
  });

  it("does not call onAccess on access denial", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-1", {
      createdAt: new Date().toISOString(),
      passcode: "secret",
    });
    const onAccess = vi.fn();
    const handler = createHandler({ storage, onAccess });

    await handler(makeRequest({ path: "/shl-1" }));

    expect(onAccess).not.toHaveBeenCalled();
  });

  it("does not break response if onAccess throws", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-1", { createdAt: new Date().toISOString() });
    const onAccess = vi.fn().mockRejectedValue(new Error("callback failed"));
    const handler = createHandler({ storage, onAccess });

    const res = await handler(makeRequest({ path: "/shl-1" }));
    expect(res.status).toBe(200);
  });
});

describe("createHandler — path normalization", () => {
  it("handles path with leading slash", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-1", { createdAt: new Date().toISOString() });
    const handler = createHandler({ storage });

    const res = await handler(makeRequest({ path: "/shl-1" }));
    expect(res.status).toBe(200);
  });

  it("handles path without leading slash", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-1", { createdAt: new Date().toISOString() });
    const handler = createHandler({ storage });

    const res = await handler(makeRequest({ path: "shl-1" }));
    expect(res.status).toBe(200);
  });

  it("handles path with multiple leading slashes", async () => {
    const storage = new MockServerStorage();
    seedStorage(storage, "shl-1", { createdAt: new Date().toISOString() });
    const handler = createHandler({ storage });

    const res = await handler(makeRequest({ path: "///shl-1" }));
    expect(res.status).toBe(200);
  });
});
