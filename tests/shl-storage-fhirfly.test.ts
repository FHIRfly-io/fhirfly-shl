// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { FhirflyStorage } from "../src/shl/storage.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("FhirflyStorage", () => {
  const config = { apiKey: "test-key-123" };

  it("uses default API base URL", () => {
    const storage = new FhirflyStorage(config);
    expect(storage.baseUrl).toBe("https://api.fhirfly.io/public/shl");
  });

  it("uses custom API base URL", () => {
    const storage = new FhirflyStorage({ ...config, apiBaseUrl: "https://devapi.fhirfly.io" });
    expect(storage.baseUrl).toBe("https://devapi.fhirfly.io/public/shl");
  });

  it("strips trailing slash from base URL", () => {
    const storage = new FhirflyStorage({ ...config, apiBaseUrl: "https://api.fhirfly.io/" });
    expect(storage.baseUrl).toBe("https://api.fhirfly.io/public/shl");
  });

  it("exposes config", () => {
    const storage = new FhirflyStorage(config);
    expect(storage.config.apiKey).toBe("test-key-123");
  });

  describe("store()", () => {
    it("PUTs file to correct API endpoint", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 201 });
      const storage = new FhirflyStorage(config);

      await storage.store("abc123/content.jwe", "encrypted-data");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.fhirfly.io/v1/shl/abc123/files/content.jwe",
        expect.objectContaining({
          method: "PUT",
          headers: {
            "X-API-Key": "test-key-123",
            "Content-Type": "application/jose",
          },
        }),
      );
    });

    it("sends JSON content type for .json files", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 201 });
      const storage = new FhirflyStorage(config);

      await storage.store("abc123/manifest.json", '{"files":[]}');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            "Content-Type": "application/json",
          }),
        }),
      );
    });

    it("handles Uint8Array content", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 201 });
      const storage = new FhirflyStorage(config);
      const data = new Uint8Array([1, 2, 3, 4]);

      await storage.store("abc123/content.jwe", data);

      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it("throws StorageError on API failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 413,
        statusText: "Payload Too Large",
        text: async () => "File too large",
      });
      const storage = new FhirflyStorage(config);

      await expect(storage.store("abc123/content.jwe", "data")).rejects.toThrow(
        "FHIRfly API error (413)",
      );
    });

    it("throws StorageError on invalid key format", async () => {
      const storage = new FhirflyStorage(config);

      await expect(storage.store("no-slash", "data")).rejects.toThrow(
        "Invalid storage key format",
      );
    });

    it("uses custom API base URL for store", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 201 });
      const storage = new FhirflyStorage({ ...config, apiBaseUrl: "https://devapi.fhirfly.io" });

      await storage.store("abc/metadata.json", "{}");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://devapi.fhirfly.io/v1/shl/abc/files/metadata.json",
        expect.any(Object),
      );
    });
  });

  describe("delete()", () => {
    it("DELETEs SHL via API", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });
      const storage = new FhirflyStorage(config);

      await storage.delete("abc123/");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.fhirfly.io/v1/shl/abc123",
        expect.objectContaining({
          method: "DELETE",
          headers: { "X-API-Key": "test-key-123" },
        }),
      );
    });

    it("handles prefix without trailing slash", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, status: 204 });
      const storage = new FhirflyStorage(config);

      await storage.delete("abc123");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.fhirfly.io/v1/shl/abc123",
        expect.any(Object),
      );
    });

    it("ignores 404 on delete", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        text: async () => "Not found",
      });
      const storage = new FhirflyStorage(config);

      // Should not throw
      await storage.delete("abc123/");
    });

    it("throws StorageError on non-404 API failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "Server error",
      });
      const storage = new FhirflyStorage(config);

      await expect(storage.delete("abc123/")).rejects.toThrow(
        "FHIRfly API error (500)",
      );
    });
  });
});
