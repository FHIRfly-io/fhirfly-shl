import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SHL, StorageError } from "../src/index.js";

// ---------------------------------------------------------------------------
// LocalStorage (unchanged — 8 tests)
// ---------------------------------------------------------------------------

describe("LocalStorage", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "shl-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("store() creates a file on disk", async () => {
    const storage = new SHL.LocalStorage({
      directory: tempDir,
      baseUrl: "https://shl.example.com",
    });

    await storage.store("test-file.txt", "hello world");

    const content = readFileSync(join(tempDir, "test-file.txt"), "utf8");
    expect(content).toBe("hello world");
  });

  it("store() creates nested directories", async () => {
    const storage = new SHL.LocalStorage({
      directory: tempDir,
      baseUrl: "https://shl.example.com",
    });

    await storage.store("abc123/content.jwe", "encrypted-data");

    const content = readFileSync(join(tempDir, "abc123", "content.jwe"), "utf8");
    expect(content).toBe("encrypted-data");
  });

  it("store() handles Uint8Array content", async () => {
    const storage = new SHL.LocalStorage({
      directory: tempDir,
      baseUrl: "https://shl.example.com",
    });

    const data = new Uint8Array([1, 2, 3, 4, 5]);
    await storage.store("binary.dat", data);

    const content = readFileSync(join(tempDir, "binary.dat"));
    expect(Buffer.from(content)).toEqual(Buffer.from(data));
  });

  it("delete() removes directory recursively", async () => {
    const storage = new SHL.LocalStorage({
      directory: tempDir,
      baseUrl: "https://shl.example.com",
    });

    await storage.store("shl-id/content.jwe", "data1");
    await storage.store("shl-id/manifest.json", "data2");
    expect(existsSync(join(tempDir, "shl-id"))).toBe(true);

    await storage.delete("shl-id");
    expect(existsSync(join(tempDir, "shl-id"))).toBe(false);
  });

  it("delete() does not throw for non-existent prefix", async () => {
    const storage = new SHL.LocalStorage({
      directory: tempDir,
      baseUrl: "https://shl.example.com",
    });

    await expect(storage.delete("nonexistent")).resolves.toBeUndefined();
  });

  it("baseUrl getter strips trailing slashes", () => {
    const storage = new SHL.LocalStorage({
      directory: tempDir,
      baseUrl: "https://shl.example.com///",
    });
    expect(storage.baseUrl).toBe("https://shl.example.com");
  });

  it("config getter returns the original config", () => {
    const config = {
      directory: tempDir,
      baseUrl: "https://shl.example.com",
    };
    const storage = new SHL.LocalStorage(config);
    expect(storage.config).toBe(config);
  });

  it("files are readable after store", async () => {
    const storage = new SHL.LocalStorage({
      directory: tempDir,
      baseUrl: "https://shl.example.com",
    });

    const manifest = JSON.stringify({ files: [{ contentType: "application/fhir+json" }] });
    await storage.store("id123/manifest.json", manifest);

    const content = readFileSync(join(tempDir, "id123", "manifest.json"), "utf8");
    expect(JSON.parse(content)).toEqual({ files: [{ contentType: "application/fhir+json" }] });
  });
});

// ---------------------------------------------------------------------------
// S3Storage (mocked @aws-sdk/client-s3)
// ---------------------------------------------------------------------------

const mockSend = vi.fn();

const MockPutObjectCommand = vi.fn();
const MockListObjectsV2Command = vi.fn();
const MockDeleteObjectsCommand = vi.fn();

vi.mock("@aws-sdk/client-s3", () => {
  class S3Client {
    send = mockSend;
  }
  return {
    S3Client,
    PutObjectCommand: MockPutObjectCommand,
    ListObjectsV2Command: MockListObjectsV2Command,
    DeleteObjectsCommand: MockDeleteObjectsCommand,
  };
});

function makeStorage(overrides?: Partial<SHL.S3StorageConfig>) {
  return new SHL.S3Storage({
    bucket: "test-bucket",
    region: "us-east-1",
    baseUrl: "https://shl.example.com",
    ...overrides,
  });
}

describe("S3Storage", () => {
  beforeEach(() => {
    mockSend.mockReset();
    mockSend.mockResolvedValue({});
    MockPutObjectCommand.mockClear();
    MockListObjectsV2Command.mockClear();
    MockDeleteObjectsCommand.mockClear();
  });

  // -- Config ---------------------------------------------------------------

  describe("config", () => {
    it("creates an instance with config", () => {
      const storage = makeStorage();
      expect(storage).toBeInstanceOf(SHL.S3Storage);
      expect(storage.config.bucket).toBe("test-bucket");
      expect(storage.config.region).toBe("us-east-1");
    });

    it("baseUrl getter strips trailing slashes", () => {
      const storage = makeStorage({ baseUrl: "https://shl.example.com///" });
      expect(storage.baseUrl).toBe("https://shl.example.com");
    });

    it("config getter returns the original config", () => {
      const config = {
        bucket: "b",
        region: "us-west-2",
        baseUrl: "https://shl.example.com",
      };
      const storage = new SHL.S3Storage(config);
      expect(storage.config).toBe(config);
    });
  });

  // -- store() --------------------------------------------------------------

  describe("store()", () => {
    it("sends PutObjectCommand with correct bucket and key", async () => {
      const storage = makeStorage();
      await storage.store("abc/content.jwe", "encrypted-data");

      expect(MockPutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: "test-bucket",
          Key: "abc/content.jwe",
        }),
      );
    });

    it("prepends prefix to key", async () => {
      const storage = makeStorage({ prefix: "shl-data" });
      await storage.store("abc/content.jwe", "data");

      expect(MockPutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: "shl-data/abc/content.jwe",
        }),
      );
    });

    it("strips trailing slash from prefix", async () => {
      const storage = makeStorage({ prefix: "shl-data/" });
      await storage.store("abc/manifest.json", "{}");

      expect(MockPutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Key: "shl-data/abc/manifest.json",
        }),
      );
    });

    it("sets ContentType application/jose for .jwe files", async () => {
      const storage = makeStorage();
      await storage.store("abc/content.jwe", "data");

      expect(MockPutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ContentType: "application/jose",
        }),
      );
    });

    it("sets ContentType application/json for .json files", async () => {
      const storage = makeStorage();
      await storage.store("abc/manifest.json", "{}");

      expect(MockPutObjectCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          ContentType: "application/json",
        }),
      );
    });

    it("converts string content to Buffer", async () => {
      const storage = makeStorage();
      await storage.store("abc/content.jwe", "hello");

      const call = MockPutObjectCommand.mock.calls[0]![0] as { Body: unknown };
      expect(Buffer.isBuffer(call.Body)).toBe(true);
      expect(call.Body).toEqual(Buffer.from("hello", "utf8"));
    });

    it("passes Uint8Array content unchanged", async () => {
      const storage = makeStorage();
      const data = new Uint8Array([1, 2, 3]);
      await storage.store("abc/binary.dat", data);

      const call = MockPutObjectCommand.mock.calls[0]![0] as { Body: unknown };
      expect(call.Body).toBe(data);
    });

    it("wraps SDK errors in StorageError", async () => {
      mockSend.mockRejectedValue(new Error("Access Denied"));
      const storage = makeStorage();

      const err = await storage.store("key", "val").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StorageError);
      expect((err as StorageError).operation).toBe("store");
    });

    it("reuses the S3 client across calls", async () => {
      const storage = makeStorage();
      await storage.store("a", "1");
      await storage.store("b", "2");

      expect(mockSend).toHaveBeenCalledTimes(2);
    });
  });

  // -- delete() -------------------------------------------------------------

  describe("delete()", () => {
    it("lists then deletes objects", async () => {
      mockSend
        .mockResolvedValueOnce({
          Contents: [{ Key: "abc/content.jwe" }, { Key: "abc/manifest.json" }],
          IsTruncated: false,
        })
        .mockResolvedValueOnce({});

      const storage = makeStorage();
      await storage.delete("abc");

      expect(mockSend).toHaveBeenCalledTimes(2);

      expect(MockDeleteObjectsCommand).toHaveBeenCalledWith(
        expect.objectContaining({
          Bucket: "test-bucket",
          Delete: {
            Objects: [{ Key: "abc/content.jwe" }, { Key: "abc/manifest.json" }],
            Quiet: true,
          },
        }),
      );
    });

    it("prepends prefix when deleting", async () => {
      mockSend.mockResolvedValueOnce({
        Contents: [{ Key: "pfx/abc/content.jwe" }],
        IsTruncated: false,
      }).mockResolvedValueOnce({});

      const storage = makeStorage({ prefix: "pfx" });
      await storage.delete("abc");

      expect(MockListObjectsV2Command).toHaveBeenCalledWith(
        expect.objectContaining({
          Prefix: "pfx/abc",
        }),
      );
    });

    it("returns silently when no objects found", async () => {
      mockSend.mockResolvedValueOnce({ Contents: [] });
      const storage = makeStorage();

      await expect(storage.delete("empty")).resolves.toBeUndefined();
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it("handles pagination with IsTruncated", async () => {
      mockSend
        .mockResolvedValueOnce({
          Contents: [{ Key: "abc/file1" }],
          IsTruncated: true,
          NextContinuationToken: "token123",
        })
        .mockResolvedValueOnce({}) // delete first batch
        .mockResolvedValueOnce({
          Contents: [{ Key: "abc/file2" }],
          IsTruncated: false,
        })
        .mockResolvedValueOnce({}); // delete second batch

      const storage = makeStorage();
      await storage.delete("abc");

      expect(mockSend).toHaveBeenCalledTimes(4);
    });

    it("wraps SDK errors in StorageError", async () => {
      mockSend.mockRejectedValue(new Error("Network error"));
      const storage = makeStorage();

      const err = await storage.delete("abc").catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StorageError);
      expect((err as StorageError).operation).toBe("delete");
    });
  });
});
