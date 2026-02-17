import { describe, it, expect } from "vitest";
import {
  base64url,
  base64urlDecode,
  generateKey,
  generateShlId,
  encryptBundle,
  decryptBundle,
} from "../src/shl/crypto.js";

describe("base64url encoding", () => {
  it("roundtrips arbitrary bytes", () => {
    const original = Buffer.from([0, 1, 2, 255, 254, 253]);
    const encoded = base64url(original);
    const decoded = base64urlDecode(encoded);
    expect(decoded).toEqual(original);
  });

  it("produces URL-safe output (no +, /, or =)", () => {
    // Use bytes that would produce + / = in standard base64
    const data = Buffer.from([251, 255, 254, 62, 63]);
    const encoded = base64url(data);
    expect(encoded).not.toMatch(/[+/=]/);
  });
});

describe("generateKey", () => {
  it("returns a 32-byte Buffer", () => {
    const key = generateKey();
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);
  });

  it("generates unique keys", () => {
    const key1 = generateKey();
    const key2 = generateKey();
    expect(key1.equals(key2)).toBe(false);
  });
});

describe("generateShlId", () => {
  it("returns a 43-character base64url string", () => {
    const id = generateShlId();
    expect(id.length).toBe(43);
    // base64url alphabet: A-Z, a-z, 0-9, -, _
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("generates unique IDs", () => {
    const id1 = generateShlId();
    const id2 = generateShlId();
    expect(id1).not.toBe(id2);
  });
});

describe("encryptBundle / decryptBundle", () => {
  const bundle = { resourceType: "Bundle", type: "document", entry: [] };

  it("produces a valid JWE compact serialization (5 dot-separated parts)", () => {
    const key = generateKey();
    const jwe = encryptBundle(bundle, key);
    const parts = jwe.split(".");
    expect(parts.length).toBe(5);
  });

  it("has an empty encrypted key segment (alg: dir)", () => {
    const key = generateKey();
    const jwe = encryptBundle(bundle, key);
    const parts = jwe.split(".");
    expect(parts[1]).toBe("");
  });

  it("JWE header contains correct fields", () => {
    const key = generateKey();
    const jwe = encryptBundle(bundle, key);
    const headerB64 = jwe.split(".")[0]!;
    const header = JSON.parse(base64urlDecode(headerB64).toString("utf8"));
    expect(header).toEqual({
      alg: "dir",
      enc: "A256GCM",
      cty: "application/fhir+json",
      zip: "DEF",
    });
  });

  it("roundtrip decrypt returns the original bundle", () => {
    const key = generateKey();
    const jwe = encryptBundle(bundle, key);
    const decrypted = decryptBundle(jwe, key);
    expect(decrypted).toEqual(bundle);
  });

  it("different IVs produce different ciphertexts for same key+plaintext", () => {
    const key = generateKey();
    const jwe1 = encryptBundle(bundle, key);
    const jwe2 = encryptBundle(bundle, key);
    // The IV and ciphertext segments should differ
    expect(jwe1).not.toBe(jwe2);
  });

  it("decryption with wrong key throws", () => {
    const key1 = generateKey();
    const key2 = generateKey();
    const jwe = encryptBundle(bundle, key1);
    expect(() => decryptBundle(jwe, key2)).toThrow();
  });

  it("rejects invalid JWE format", () => {
    const key = generateKey();
    expect(() => decryptBundle("not.a.valid.jwe", key)).toThrow(
      "expected 5 parts",
    );
  });

  it("handles large bundles", () => {
    const key = generateKey();
    const largeBundle = {
      resourceType: "Bundle",
      entry: Array.from({ length: 100 }, (_, i) => ({
        resource: { id: `resource-${i}`, data: "x".repeat(1000) },
      })),
    };
    const jwe = encryptBundle(largeBundle, key);
    const decrypted = decryptBundle(jwe, key);
    expect(decrypted).toEqual(largeBundle);
  });
});
