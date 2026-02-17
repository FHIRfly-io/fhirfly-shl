import { describe, it, expect } from "vitest";
import { SHL } from "../src/index.js";
import type { SHLStorage } from "../src/shl/types.js";
import { base64url, base64urlDecode } from "../src/shl/crypto.js";

/** In-memory mock storage for tests. */
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

describe("SHL.decode() — valid URLs", () => {
  it("round-trips: create → decode → fields match", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({
      bundle: testBundle,
      storage,
      passcode: "1234",
      expiresAt: new Date("2026-12-31T00:00:00Z"),
      label: "Test IPS",
    });

    const decoded = SHL.decode(result.url);
    expect(decoded.url).toBe(`${storage.baseUrl}/${result.id}`);
    expect(decoded.key).toBeInstanceOf(Buffer);
    expect(decoded.key.length).toBe(32);
    expect(decoded.flag).toBe("LP");
    expect(decoded.v).toBe(1);
    expect(decoded.exp).toBe(Math.floor(new Date("2026-12-31T00:00:00Z").getTime() / 1000));
    expect(decoded.label).toBe("Test IPS");
  });

  it("decode without passcode → flag is L, no P", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage });

    const decoded = SHL.decode(result.url);
    expect(decoded.flag).toBe("L");
  });

  it("decode without expiresAt → exp is undefined", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage });

    const decoded = SHL.decode(result.url);
    expect(decoded.exp).toBeUndefined();
  });

  it("decode without label → label is undefined", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage });

    const decoded = SHL.decode(result.url);
    expect(decoded.label).toBeUndefined();
  });

  it("v defaults to 1 when missing from payload", () => {
    const payload = {
      url: "https://shl.example.com/abc",
      key: base64url(Buffer.alloc(32, 0x42)),
      flag: "L",
    };
    const b64 = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
    const decoded = SHL.decode(`shlink:/${b64}`);
    expect(decoded.v).toBe(1);
  });
});

describe("SHL.decode() — error handling", () => {
  it("throws for empty string", () => {
    expect(() => SHL.decode("")).toThrow("url is required");
  });

  it("throws for non-shlink URL", () => {
    expect(() => SHL.decode("https://example.com")).toThrow('must start with "shlink:/"');
  });

  it("throws for shlink:/ with empty payload", () => {
    expect(() => SHL.decode("shlink:/")).toThrow("empty payload");
  });

  it("throws for invalid base64url payload", () => {
    expect(() => SHL.decode("shlink:/!!!not-valid-b64!!!")).toThrow("could not decode");
  });

  it("throws for payload missing url field", () => {
    const payload = { key: base64url(Buffer.alloc(32)), flag: "L" };
    const b64 = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
    expect(() => SHL.decode(`shlink:/${b64}`)).toThrow("missing or invalid 'url'");
  });

  it("throws for payload missing key field", () => {
    const payload = { url: "https://example.com/abc", flag: "L" };
    const b64 = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
    expect(() => SHL.decode(`shlink:/${b64}`)).toThrow("missing or invalid 'key'");
  });

  it("throws for payload missing flag field", () => {
    const payload = { url: "https://example.com/abc", key: base64url(Buffer.alloc(32)) };
    const b64 = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
    expect(() => SHL.decode(`shlink:/${b64}`)).toThrow("missing or invalid 'flag'");
  });

  it("throws for key with wrong length", () => {
    const payload = {
      url: "https://example.com/abc",
      key: base64url(Buffer.alloc(16)), // 16 bytes, should be 32
      flag: "L",
    };
    const b64 = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
    expect(() => SHL.decode(`shlink:/${b64}`)).toThrow("key must be 32 bytes");
  });
});

describe("SHL.decrypt() — round-trip", () => {
  it("create → decode → decrypt → matches original bundle", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage });

    // Decode the URL to get the key
    const decoded = SHL.decode(result.url);

    // Get the stored JWE content
    const jwe = storage.files.get(`${result.id}/content.jwe`) as string;
    expect(jwe).toBeDefined();

    // Decrypt with the key from decode
    const decrypted = SHL.decrypt(jwe, decoded.key);
    expect(decrypted).toEqual(testBundle);
  });

  it("works with complex bundle", async () => {
    const complexBundle = {
      resourceType: "Bundle",
      type: "document",
      entry: Array.from({ length: 50 }, (_, i) => ({
        resource: {
          resourceType: "Observation",
          id: `obs-${i}`,
          code: { coding: [{ system: "http://loinc.org", code: `${1000 + i}` }] },
          valueQuantity: { value: Math.random() * 100, unit: "mg/dL" },
        },
      })),
    };

    const storage = new MockStorage();
    const result = await SHL.create({ bundle: complexBundle, storage });
    const decoded = SHL.decode(result.url);
    const jwe = storage.files.get(`${result.id}/content.jwe`) as string;
    const decrypted = SHL.decrypt(jwe, decoded.key);
    expect(decrypted).toEqual(complexBundle);
  });
});

describe("SHL.decrypt() — error handling", () => {
  it("throws for empty jwe string", () => {
    const key = Buffer.alloc(32);
    expect(() => SHL.decrypt("", key)).toThrow("jwe is required");
  });

  it("throws for invalid key length", () => {
    expect(() => SHL.decrypt("a.b.c.d.e", Buffer.alloc(16))).toThrow("32-byte Buffer");
  });

  it("throws for malformed JWE (wrong number of parts)", () => {
    const key = Buffer.alloc(32);
    expect(() => SHL.decrypt("not.a.jwe", key)).toThrow();
  });

  it("throws for JWE with wrong key", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage });
    const jwe = storage.files.get(`${result.id}/content.jwe`) as string;
    const wrongKey = Buffer.alloc(32, 0xff);

    expect(() => SHL.decrypt(jwe, wrongKey)).toThrow();
  });
});
