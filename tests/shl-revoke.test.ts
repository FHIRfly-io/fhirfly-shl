import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SHL } from "../src/index.js";

describe("SHL.revoke()", () => {
  let tempDir: string;
  let storage: InstanceType<typeof SHL.LocalStorage>;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "shl-revoke-"));
    storage = new SHL.LocalStorage({
      directory: tempDir,
      baseUrl: "https://shl.example.com",
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("deletes all stored files for an SHL", async () => {
    // Create mock SHL files
    await storage.store("test-shl/content.jwe", "encrypted-data");
    await storage.store("test-shl/manifest.json", "{}");
    await storage.store("test-shl/metadata.json", "{}");
    expect(existsSync(join(tempDir, "test-shl"))).toBe(true);

    await SHL.revoke("test-shl", storage);

    expect(existsSync(join(tempDir, "test-shl"))).toBe(false);
  });

  it("does not throw for a non-existent SHL", async () => {
    await expect(
      SHL.revoke("nonexistent-id", storage)
    ).resolves.toBeUndefined();
  });

  it("does not affect other SHLs", async () => {
    await storage.store("shl-a/content.jwe", "data-a");
    await storage.store("shl-b/content.jwe", "data-b");

    await SHL.revoke("shl-a", storage);

    expect(existsSync(join(tempDir, "shl-a"))).toBe(false);
    expect(existsSync(join(tempDir, "shl-b"))).toBe(true);
  });

  it("throws if shlId is empty", async () => {
    await expect(SHL.revoke("", storage)).rejects.toThrow("shlId is required");
  });
});
