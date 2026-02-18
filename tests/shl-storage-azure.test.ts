// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StorageError } from "../src/errors.js";

// ---------------------------------------------------------------------------
// Mock @azure/storage-blob
// ---------------------------------------------------------------------------

const mockUpload = vi.fn().mockResolvedValue({});
const mockDeleteIfExists = vi.fn().mockResolvedValue({});
const mockDownload = vi.fn().mockResolvedValue({
  readableStreamBody: {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from('{"test":"data"}');
    },
  },
});

const mockListBlobsFlat = vi.fn().mockReturnValue({
  async *[Symbol.asyncIterator]() {
    yield { name: "prefix/content.jwe" };
    yield { name: "prefix/manifest.json" };
  },
});

const mockGetBlockBlobClient = vi.fn().mockReturnValue({
  upload: mockUpload,
  deleteIfExists: mockDeleteIfExists,
  download: mockDownload,
});

const mockGetContainerClient = vi.fn().mockReturnValue({
  getBlockBlobClient: mockGetBlockBlobClient,
  listBlobsFlat: mockListBlobsFlat,
});

vi.mock("@azure/storage-blob", () => ({
  BlobServiceClient: {
    fromConnectionString: vi.fn().mockReturnValue({
      getContainerClient: mockGetContainerClient,
    }),
  },
}));

// Import AFTER mock setup
const { AzureStorage } = await import("../src/shl/storage.js");
const { ServerAzureStorage } = await import("../src/server/storage.js");

const CONFIG = {
  container: "test-container",
  connectionString: "DefaultEndpointsProtocol=https;AccountName=test;AccountKey=key;EndpointSuffix=core.windows.net",
  baseUrl: "https://shl.example.com",
};

// ---------------------------------------------------------------------------
// AzureStorage (write-only)
// ---------------------------------------------------------------------------

describe("AzureStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("exposes baseUrl", () => {
    const storage = new AzureStorage(CONFIG);
    expect(storage.baseUrl).toBe("https://shl.example.com");
  });

  it("strips trailing slashes from baseUrl", () => {
    const storage = new AzureStorage({ ...CONFIG, baseUrl: "https://shl.example.com/" });
    expect(storage.baseUrl).toBe("https://shl.example.com");
  });

  it("stores content via upload()", async () => {
    const storage = new AzureStorage(CONFIG);
    await storage.store("test-id/content.jwe", "encrypted-data");

    expect(mockGetBlockBlobClient).toHaveBeenCalledWith("test-id/content.jwe");
    expect(mockUpload).toHaveBeenCalled();
    const [body, length] = mockUpload.mock.calls[0]!;
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(length).toBe(Buffer.from("encrypted-data", "utf8").length);
  });

  it("applies prefix when configured", async () => {
    const storage = new AzureStorage({ ...CONFIG, prefix: "shl-data" });
    await storage.store("test-id/content.jwe", "data");

    expect(mockGetBlockBlobClient).toHaveBeenCalledWith("shl-data/test-id/content.jwe");
  });

  it("deletes by listing and deleting each blob", async () => {
    const storage = new AzureStorage(CONFIG);
    await storage.delete("test-id");

    expect(mockListBlobsFlat).toHaveBeenCalledWith({ prefix: "test-id" });
    expect(mockDeleteIfExists).toHaveBeenCalledTimes(2);
  });

  it("wraps errors in StorageError", async () => {
    mockUpload.mockRejectedValueOnce(new Error("Azure error"));

    const storage = new AzureStorage(CONFIG);
    await expect(storage.store("key", "data")).rejects.toThrow(StorageError);
  });

  it("exposes config", () => {
    const storage = new AzureStorage(CONFIG);
    expect(storage.config.container).toBe("test-container");
  });
});

// ---------------------------------------------------------------------------
// ServerAzureStorage (read + updateMetadata)
// ---------------------------------------------------------------------------

describe("ServerAzureStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads blob content", async () => {
    const storage = new ServerAzureStorage(CONFIG);
    const content = await storage.read("test-id/manifest.json");

    expect(content).toBe('{"test":"data"}');
  });

  it("returns null for missing blob (404)", async () => {
    mockDownload.mockRejectedValueOnce(Object.assign(new Error("Not found"), { statusCode: 404 }));

    const storage = new ServerAzureStorage(CONFIG);
    const content = await storage.read("missing/file.json");

    expect(content).toBeNull();
  });

  it("updates metadata via read-modify-write", async () => {
    mockDownload.mockResolvedValueOnce({
      readableStreamBody: {
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(JSON.stringify({ createdAt: "2026-01-01", accessCount: 0 }));
        },
      },
    });

    const storage = new ServerAzureStorage(CONFIG);
    const result = await storage.updateMetadata("test-id", (current) => ({
      ...current,
      accessCount: (current.accessCount ?? 0) + 1,
    }));

    expect(result).not.toBeNull();
    expect(result!.accessCount).toBe(1);
    expect(mockUpload).toHaveBeenCalled();
  });

  it("returns null from updateMetadata when SHL not found", async () => {
    mockDownload.mockRejectedValueOnce(Object.assign(new Error("Not found"), { statusCode: 404 }));

    const storage = new ServerAzureStorage(CONFIG);
    const result = await storage.updateMetadata("missing-id", (m) => m);

    expect(result).toBeNull();
  });
});
