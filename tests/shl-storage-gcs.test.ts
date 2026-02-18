// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StorageError } from "../src/errors.js";

// ---------------------------------------------------------------------------
// Mock @google-cloud/storage
// ---------------------------------------------------------------------------

// All mock functions must be defined before vi.mock for hoisting
const mockSave = vi.fn().mockResolvedValue(undefined);
const mockGcsDelete = vi.fn().mockResolvedValue([{}]);
const mockDownload = vi.fn().mockResolvedValue([Buffer.from('{"test":"data"}')]);

const mockGetFiles = vi.fn().mockResolvedValue([
  [
    { name: "prefix/content.jwe", save: mockSave, delete: mockGcsDelete, download: mockDownload },
    { name: "prefix/manifest.json", save: mockSave, delete: mockGcsDelete, download: mockDownload },
  ],
]);

const mockFile = vi.fn().mockReturnValue({
  save: mockSave,
  delete: mockGcsDelete,
  download: mockDownload,
  name: "test-file",
});

const mockBucketObj = {
  file: mockFile,
  getFiles: mockGetFiles,
};

vi.mock("@google-cloud/storage", () => {
  // Must define the class inside the factory to avoid hoisting issues
  class MockStorage {
    bucket() {
      return mockBucketObj;
    }
  }
  return { Storage: MockStorage };
});

// Import AFTER mock setup
const { GCSStorage } = await import("../src/shl/storage.js");
const { ServerGCSStorage } = await import("../src/server/storage.js");

const CONFIG = {
  bucket: "test-bucket",
  baseUrl: "https://shl.example.com",
};

// ---------------------------------------------------------------------------
// GCSStorage (write-only)
// ---------------------------------------------------------------------------

describe("GCSStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes baseUrl", () => {
    const storage = new GCSStorage(CONFIG);
    expect(storage.baseUrl).toBe("https://shl.example.com");
  });

  it("strips trailing slashes from baseUrl", () => {
    const storage = new GCSStorage({ ...CONFIG, baseUrl: "https://shl.example.com/" });
    expect(storage.baseUrl).toBe("https://shl.example.com");
  });

  it("stores content via file.save()", async () => {
    const storage = new GCSStorage(CONFIG);
    await storage.store("test-id/content.jwe", "encrypted-data");

    expect(mockFile).toHaveBeenCalledWith("test-id/content.jwe");
    expect(mockSave).toHaveBeenCalled();
    const [body, opts] = mockSave.mock.calls[0]!;
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(opts.contentType).toBe("application/jose");
    expect(opts.resumable).toBe(false);
  });

  it("applies prefix when configured", async () => {
    const storage = new GCSStorage({ ...CONFIG, prefix: "shl-data" });
    await storage.store("test-id/content.jwe", "data");

    expect(mockFile).toHaveBeenCalledWith("shl-data/test-id/content.jwe");
  });

  it("deletes by listing and deleting each file", async () => {
    const storage = new GCSStorage(CONFIG);
    await storage.delete("test-id");

    expect(mockGetFiles).toHaveBeenCalledWith({ prefix: "test-id" });
    expect(mockGcsDelete).toHaveBeenCalledTimes(2);
  });

  it("wraps errors in StorageError", async () => {
    mockSave.mockRejectedValueOnce(new Error("GCS error"));

    const storage = new GCSStorage(CONFIG);
    await expect(storage.store("key", "data")).rejects.toThrow(StorageError);
  });

  it("exposes config", () => {
    const storage = new GCSStorage(CONFIG);
    expect(storage.config.bucket).toBe("test-bucket");
  });

  it("sets JSON content type for .json files", async () => {
    const storage = new GCSStorage(CONFIG);
    await storage.store("test-id/manifest.json", '{"files":[]}');

    const [, opts] = mockSave.mock.calls[0]!;
    expect(opts.contentType).toBe("application/json");
  });
});

// ---------------------------------------------------------------------------
// ServerGCSStorage (read + updateMetadata)
// ---------------------------------------------------------------------------

describe("ServerGCSStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads file content", async () => {
    const storage = new ServerGCSStorage(CONFIG);
    const content = await storage.read("test-id/manifest.json");

    expect(content).toBe('{"test":"data"}');
  });

  it("returns null for missing file (404)", async () => {
    mockDownload.mockRejectedValueOnce(Object.assign(new Error("Not found"), { code: 404 }));

    const storage = new ServerGCSStorage(CONFIG);
    const content = await storage.read("missing/file.json");

    expect(content).toBeNull();
  });

  it("updates metadata via read-modify-write", async () => {
    mockDownload.mockResolvedValueOnce([
      Buffer.from(JSON.stringify({ createdAt: "2026-01-01", accessCount: 0 })),
    ]);

    const storage = new ServerGCSStorage(CONFIG);
    const result = await storage.updateMetadata("test-id", (current) => ({
      ...current,
      accessCount: (current.accessCount ?? 0) + 1,
    }));

    expect(result).not.toBeNull();
    expect(result!.accessCount).toBe(1);
    expect(mockSave).toHaveBeenCalled();
  });

  it("returns null from updateMetadata when SHL not found", async () => {
    mockDownload.mockRejectedValueOnce(Object.assign(new Error("Not found"), { code: 404 }));

    const storage = new ServerGCSStorage(CONFIG);
    const result = await storage.updateMetadata("missing-id", (m) => m);

    expect(result).toBeNull();
  });
});
