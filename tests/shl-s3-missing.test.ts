import { describe, it, expect } from "vitest";
import { SHL, StorageError } from "../src/index.js";

/**
 * Tests that S3Storage throws a helpful error when @aws-sdk/client-s3
 * is not installed. Since it's an optional peer dependency, the real
 * dynamic import will fail in this test environment.
 *
 * This file must NOT use vi.mock("@aws-sdk/client-s3").
 */
describe("S3Storage — missing @aws-sdk/client-s3", () => {
  it("store() throws StorageError mentioning @aws-sdk/client-s3", async () => {
    const storage = new SHL.S3Storage({
      bucket: "test-bucket",
      region: "us-east-1",
      baseUrl: "https://shl.example.com",
    });

    await expect(storage.store("key", "value")).rejects.toThrow(StorageError);
    await expect(storage.store("key", "value")).rejects.toThrow(
      "@aws-sdk/client-s3",
    );
  });

  it("delete() throws StorageError with install instructions", async () => {
    const storage = new SHL.S3Storage({
      bucket: "test-bucket",
      region: "us-east-1",
      baseUrl: "https://shl.example.com",
    });

    await expect(storage.delete("prefix")).rejects.toThrow(StorageError);
    await expect(storage.delete("prefix")).rejects.toThrow(
      "npm install @aws-sdk/client-s3",
    );
  });
});
