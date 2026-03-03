// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import { describe, it, expect } from "vitest";
import { SHL } from "../src/index.js";
import type { SHLStorage, SHLMetadata, Manifest } from "../src/shl/types.js";
import { base64urlDecode, decryptBundle } from "../src/shl/crypto.js";

/** In-memory mock storage. */
class MockStorage implements SHLStorage {
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
}

const testBundle = {
  resourceType: "Bundle",
  type: "collection",
  entry: [{ resource: { resourceType: "Patient", name: [{ family: "Test" }] } }],
};

function parseShlPayload(url: string): Record<string, unknown> {
  const b64 = url.replace("shlink:/", "");
  return JSON.parse(base64urlDecode(b64).toString("utf8")) as Record<string, unknown>;
}

describe("SHL.create() — PSHD compliance preset", () => {
  it("flag is U (direct mode) when compliance=pshd", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({
      bundle: testBundle,
      storage,
      compliance: "pshd",
      expiresAt: new Date(Date.now() + 15 * 60_000),
    });
    const payload = parseShlPayload(result.url);
    expect(payload["flag"]).toBe("U");
  });

  it("exp is set in payload when compliance=pshd", async () => {
    const storage = new MockStorage();
    const expires = new Date(Date.now() + 15 * 60_000);
    const result = await SHL.create({
      bundle: testBundle,
      storage,
      compliance: "pshd",
      expiresAt: expires,
    });
    const payload = parseShlPayload(result.url);
    expect(payload["exp"]).toBe(Math.floor(expires.getTime() / 1000));
  });

  it("throws if passcode provided with compliance=pshd", async () => {
    const storage = new MockStorage();
    await expect(
      SHL.create({
        bundle: testBundle,
        storage,
        compliance: "pshd",
        passcode: "1234",
        expiresAt: new Date(Date.now() + 15 * 60_000),
      }),
    ).rejects.toThrow("PSHD compliance forbids passcode");
  });

  it("throws if expiresAt missing with compliance=pshd", async () => {
    const storage = new MockStorage();
    await expect(
      SHL.create({
        bundle: testBundle,
        storage,
        compliance: "pshd",
      }),
    ).rejects.toThrow("PSHD compliance requires expiresAt");
  });

  it("does not store manifest.json (direct mode)", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({
      bundle: testBundle,
      storage,
      compliance: "pshd",
      expiresAt: new Date(Date.now() + 15 * 60_000),
    });
    const hasManifest = [...storage.files.keys()].some((k) => k.endsWith("/manifest.json"));
    expect(hasManifest).toBe(false);
  });

  it("metadata has mode=direct", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({
      bundle: testBundle,
      storage,
      compliance: "pshd",
      expiresAt: new Date(Date.now() + 15 * 60_000),
    });
    const metadataJson = storage.files.get(`${result.id}/metadata.json`) as string;
    const metadata = JSON.parse(metadataJson) as SHLMetadata;
    expect(metadata.mode).toBe("direct");
  });
});

describe("SHL.create() — direct mode (without compliance preset)", () => {
  it("flag is U when mode=direct", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({
      bundle: testBundle,
      storage,
      mode: "direct",
    });
    const payload = parseShlPayload(result.url);
    expect(payload["flag"]).toBe("U");
  });

  it("throws if passcode provided with mode=direct", async () => {
    const storage = new MockStorage();
    await expect(
      SHL.create({
        bundle: testBundle,
        storage,
        mode: "direct",
        passcode: "1234",
      }),
    ).rejects.toThrow("Direct mode (flag U) is incompatible with passcode");
  });

  it("allows no expiresAt with mode=direct (not required without compliance)", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({
      bundle: testBundle,
      storage,
      mode: "direct",
    });
    expect(result.url).toMatch(/^shlink:\//);
  });

  it("does not store manifest.json in direct mode", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({
      bundle: testBundle,
      storage,
      mode: "direct",
    });
    const hasManifest = [...storage.files.keys()].some((k) => k.endsWith("/manifest.json"));
    expect(hasManifest).toBe(false);
  });

  it("stores content.jwe and metadata.json in direct mode", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({
      bundle: testBundle,
      storage,
      mode: "direct",
    });
    const keys = [...storage.files.keys()].sort();
    expect(keys).toEqual([
      `${result.id}/content.jwe`,
      `${result.id}/metadata.json`,
    ]);
  });

  it("roundtrip encrypt/decrypt works in direct mode", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({
      bundle: testBundle,
      storage,
      mode: "direct",
    });
    const payload = parseShlPayload(result.url);
    const key = base64urlDecode(payload["key"] as string);
    const jwe = storage.files.get(`${result.id}/content.jwe`) as string;
    const decrypted = decryptBundle(jwe, key);
    expect(decrypted).toEqual(testBundle);
  });
});

describe("SHL.create() — manifest mode (default, backward compat)", () => {
  it("flag is L when no mode specified", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage });
    const payload = parseShlPayload(result.url);
    expect(payload["flag"]).toBe("L");
  });

  it("flag is L when mode=manifest", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage, mode: "manifest" });
    const payload = parseShlPayload(result.url);
    expect(payload["flag"]).toBe("L");
  });

  it("stores manifest.json in manifest mode", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage, mode: "manifest" });
    const hasManifest = [...storage.files.keys()].some((k) => k.endsWith("/manifest.json"));
    expect(hasManifest).toBe(true);
  });

  it("metadata does not have mode field in manifest mode", async () => {
    const storage = new MockStorage();
    const result = await SHL.create({ bundle: testBundle, storage });
    const metadataJson = storage.files.get(`${result.id}/metadata.json`) as string;
    const metadata = JSON.parse(metadataJson) as SHLMetadata;
    expect(metadata.mode).toBeUndefined();
  });
});
