import { describe, it, expect } from "vitest";
import { SHL } from "../src/index.js";
import type { SHLStorage } from "../src/shl/types.js";
import { base64urlDecode, decryptBundle } from "../src/shl/crypto.js";
import type { Manifest, SHLMetadata } from "../src/shl/types.js";

/** In-memory mock storage for tests — no filesystem I/O. */
class MockStorage implements SHLStorage {
  readonly baseUrl = "https://shl.example.com";
  readonly files = new Map<string, string | Uint8Array>();

  async store(key: string, content: string | Uint8Array): Promise<void> {
    this.files.set(key, content);
  }

  async delete(prefix: string): Promise<void> {
    for (const key of this.files.keys()) {
      if (key.startsWith(prefix)) {
        this.files.delete(key);
      }
    }
  }
}

const testBundle = {
  resourceType: "Bundle",
  type: "document",
  entry: [
    {
      resource: {
        resourceType: "Patient",
        name: [{ family: "Test", given: ["Jane"] }],
      },
    },
  ],
};

/** Parse the SHL payload from a shlink:/ URL. */
function parseShlPayload(url: string): Record<string, unknown> {
  const b64 = url.replace("shlink:/", "");
  return JSON.parse(base64urlDecode(b64).toString("utf8")) as Record<string, unknown>;
}

describe("SHL.create() — core", () => {
  it("produces a valid shlink:/ URL", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage });
    expect(result.url).toMatch(/^shlink:\//);
  });

  it("SHL payload contains url, key, flag, and v: 1", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage });
    const payload = parseShlPayload(result.url);
    expect(payload).toHaveProperty("url");
    expect(payload).toHaveProperty("key");
    expect(payload).toHaveProperty("flag");
    expect(payload["v"]).toBe(1);
  });

  it("SHL payload url is {baseUrl}/{shlId}", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage });
    const payload = parseShlPayload(result.url);
    expect(payload["url"]).toBe(`${storage.baseUrl}/${result.id}`);
  });

  it("SHL payload key is 43 chars (32 bytes base64url)", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage });
    const payload = parseShlPayload(result.url);
    const key = payload["key"] as string;
    expect(key.length).toBe(43);
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("returns a QR code as a PNG data URI", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage });
    expect(result.qrCode).toMatch(/^data:image\/png;base64,/);
  });

  it("returns the SHL ID", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage });
    expect(result.id).toBeDefined();
    expect(result.id.length).toBe(43);
  });

  it("flag includes L (manifest mode always set)", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage });
    const payload = parseShlPayload(result.url);
    expect(payload["flag"]).toContain("L");
  });

  it("flag is L when no passcode", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage });
    const payload = parseShlPayload(result.url);
    expect(payload["flag"]).toBe("L");
  });
});

describe("SHL.create() — roundtrip encryption", () => {
  it("decrypt stored content.jwe with key from SHL payload matches original bundle", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage });

    // Get key from SHL payload
    const payload = parseShlPayload(result.url);
    const key = base64urlDecode(payload["key"] as string);

    // Get stored JWE
    const jwe = storage.files.get(`${result.id}/content.jwe`) as string;
    expect(jwe).toBeDefined();

    // Decrypt and verify
    const decrypted = decryptBundle(jwe, key);
    expect(decrypted).toEqual(testBundle);
  });

  it("JWE header has correct fields", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage });

    const jwe = storage.files.get(`${result.id}/content.jwe`) as string;
    const headerB64 = jwe.split(".")[0]!;
    const header = JSON.parse(base64urlDecode(headerB64).toString("utf8"));
    expect(header).toEqual({
      alg: "dir",
      enc: "A256GCM",
      cty: "application/fhir+json",
      zip: "DEF",
    });
  });
});

describe("SHL.create() — storage files", () => {
  it("stores exactly 3 files: content.jwe, manifest.json, metadata.json", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage });

    const keys = [...storage.files.keys()].sort();
    expect(keys).toEqual([
      `${result.id}/content.jwe`,
      `${result.id}/manifest.json`,
      `${result.id}/metadata.json`,
    ]);
  });

  it("manifest JSON has files[] with correct contentType and location", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage });

    const manifestJson = storage.files.get(`${result.id}/manifest.json`) as string;
    const manifest = JSON.parse(manifestJson) as Manifest;
    expect(manifest.files).toHaveLength(1);
    expect(manifest.files[0]!.contentType).toBe("application/fhir+json");
    expect(manifest.files[0]!.location).toBe(
      `${storage.baseUrl}/${result.id}/content`,
    );
  });

  it("metadata contains createdAt", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage });

    const metadataJson = storage.files.get(`${result.id}/metadata.json`) as string;
    const metadata = JSON.parse(metadataJson) as SHLMetadata;
    expect(metadata.createdAt).toBeDefined();
    // Should be a valid ISO 8601 date
    expect(new Date(metadata.createdAt).toISOString()).toBe(metadata.createdAt);
  });
});

describe("SHL.create() — options", () => {
  it("passcode → flag includes P, metadata includes passcode, result includes passcode", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({
      bundle: testBundle,
      storage,
      passcode: "1234",
    });

    const payload = parseShlPayload(result.url);
    expect(payload["flag"]).toContain("P");

    const metadataJson = storage.files.get(`${result.id}/metadata.json`) as string;
    const metadata = JSON.parse(metadataJson) as SHLMetadata;
    expect(metadata.passcode).toBe("1234");

    expect(result.passcode).toBe("1234");
  });

  it("expiresAt → SHL payload includes exp (epoch seconds), metadata includes expiresAt", async () => {
    const storage = new MockStorage();
    const expires = new Date("2026-12-31T00:00:00Z");
    const result = await SHL.create({
      bundle: testBundle,
      storage,
      expiresAt: expires,
    });

    const payload = parseShlPayload(result.url);
    expect(payload["exp"]).toBe(Math.floor(expires.getTime() / 1000));

    const metadataJson = storage.files.get(`${result.id}/metadata.json`) as string;
    const metadata = JSON.parse(metadataJson) as SHLMetadata;
    expect(metadata.expiresAt).toBe(expires.toISOString());

    expect(result.expiresAt).toEqual(expires);
  });

  it("maxAccesses → metadata includes maxAccesses", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({
      bundle: testBundle,
      storage,
      maxAccesses: 5,
    });

    const metadataJson = storage.files.get(`${result.id}/metadata.json`) as string;
    const metadata = JSON.parse(metadataJson) as SHLMetadata;
    expect(metadata.maxAccesses).toBe(5);
  });

  it("label → SHL payload includes label", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({
      bundle: testBundle,
      storage,
      label: "Jane's IPS",
    });

    const payload = parseShlPayload(result.url);
    expect(payload["label"]).toBe("Jane's IPS");
  });

  it("no passcode → no P flag, no passcode in metadata", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage });

    const payload = parseShlPayload(result.url);
    expect(payload["flag"]).not.toContain("P");

    const metadataJson = storage.files.get(`${result.id}/metadata.json`) as string;
    const metadata = JSON.parse(metadataJson) as SHLMetadata;
    expect(metadata.passcode).toBeUndefined();

    expect(result.passcode).toBeUndefined();
  });

  it("no expiresAt → no exp in payload, no expiresAt in metadata", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage });

    const payload = parseShlPayload(result.url);
    expect(payload["exp"]).toBeUndefined();

    const metadataJson = storage.files.get(`${result.id}/metadata.json`) as string;
    const metadata = JSON.parse(metadataJson) as SHLMetadata;
    expect(metadata.expiresAt).toBeUndefined();

    expect(result.expiresAt).toBeUndefined();
  });
});

describe("SHL.create() — edge cases", () => {
  it("label truncated to 80 chars", async () => {
    const storage = new MockStorage();
    const longLabel = "A".repeat(100);
    const result = await SHL.create({
      bundle: testBundle,
      storage,
      label: longLabel,
    });

    const payload = parseShlPayload(result.url);
    expect((payload["label"] as string).length).toBe(80);
  });

  it("flags are alphabetically sorted (LP not PL)", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({
      bundle: testBundle,
      storage,
      passcode: "secret",
    });

    const payload = parseShlPayload(result.url);
    expect(payload["flag"]).toBe("LP");
  });

  it("manifest URL length ≤ 128 chars", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage });

    const payload = parseShlPayload(result.url);
    const url = payload["url"] as string;
    expect(url.length).toBeLessThanOrEqual(128);
  });

  it("each create() produces a unique ID", async () => {
    const storage = new MockStorage();
    const result1 = await SHL.create({ bundle: testBundle, storage });
    const result2 = await SHL.create({ bundle: testBundle, storage });
    expect(result1.id).not.toBe(result2.id);
  });

  it("each create() produces a unique key", async () => {
    const storage = new MockStorage();
    const result1 = await SHL.create({ bundle: testBundle, storage });
    const result2 = await SHL.create({ bundle: testBundle, storage });
    const payload1 = parseShlPayload(result1.url);
    const payload2 = parseShlPayload(result2.url);
    expect(payload1["key"]).not.toBe(payload2["key"]);
  });
});

describe("SHL.create() — debug mode", () => {
  it("stores bundle.json in debug mode", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage, debug: true });

    expect(storage.files.has(`${result.id}/bundle.json`)).toBe(true);
  });

  it("bundle.json contains unencrypted FHIR data", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage, debug: true });

    const bundleJson = storage.files.get(`${result.id}/bundle.json`) as string;
    const parsed = JSON.parse(bundleJson);
    expect(parsed).toEqual(testBundle);
  });

  it("does not store bundle.json without debug flag", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage });

    const hasBundleJson = [...storage.files.keys()].some((k) => k.endsWith("/bundle.json"));
    expect(hasBundleJson).toBe(false);
  });

  it("result includes debugBundlePath in debug mode", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage, debug: true });

    expect(result.debugBundlePath).toBe(`${result.id}/bundle.json`);
  });

  it("result omits debugBundlePath without debug flag", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage });

    expect(result.debugBundlePath).toBeUndefined();
  });
});

describe("SHL.create() — validation", () => {
  it("throws ValidationError for null bundle", async () => {
    const storage = new MockStorage();
    await expect(
      SHL.create({ bundle: null as unknown as Record<string, unknown>, storage }),
    ).rejects.toThrow("bundle is required");
  });

  it("throws ValidationError for missing storage baseUrl", async () => {
    const brokenStorage = {
      baseUrl: "",
      store: async () => {},
      delete: async () => {},
    };
    await expect(
      SHL.create({ bundle: testBundle, storage: brokenStorage }),
    ).rejects.toThrow("storage with baseUrl is required");
  });
});
