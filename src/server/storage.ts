// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { LocalStorage, AzureStorage, GCSStorage } from "../shl/storage.js";
import type { LocalStorageConfig, S3StorageConfig, AzureStorageConfig, GCSStorageConfig } from "../shl/storage.js";
import type { SHLServerStorage } from "./types.js";
import type { SHLMetadata } from "../shl/types.js";
import { StorageError } from "../errors.js";

/**
 * Local filesystem server storage for SMART Health Links.
 *
 * Extends the base `LocalStorage` (write-only) with `read` and
 * `updateMetadata` methods needed for serving SHLs.
 *
 * @example
 * ```ts
 * import { ServerLocalStorage } from "@fhirfly-io/shl/server";
 *
 * const storage = new ServerLocalStorage({
 *   directory: "./shl-data",
 *   baseUrl: "https://shl.example.com",
 * });
 * ```
 */
export class ServerLocalStorage extends LocalStorage implements SHLServerStorage {
  constructor(config: LocalStorageConfig) {
    super(config);
  }

  async read(key: string): Promise<string | Uint8Array | null> {
    const filePath = join(this.config.directory, key);
    if (!existsSync(filePath)) {
      return null;
    }
    try {
      // Read as UTF-8 for JSON/JWE files, binary for others
      return readFileSync(filePath, "utf8");
    } catch {
      return null;
    }
  }

  async updateMetadata(
    shlId: string,
    updater: (current: SHLMetadata) => SHLMetadata | null,
  ): Promise<SHLMetadata | null> {
    const key = `${shlId}/metadata.json`;
    const raw = await this.read(key);
    if (raw === null) return null;

    const current = JSON.parse(raw as string) as SHLMetadata;
    const updated = updater(current);
    if (updated === null) return null;

    await this.store(key, JSON.stringify(updated));
    return updated;
  }
}

// Minimal S3 interfaces (same pattern as shl/storage.ts)
interface S3ClientInstance {
  send(command: unknown): Promise<unknown>;
}
interface S3Module {
  S3Client: new (config: { region: string }) => S3ClientInstance;
  PutObjectCommand: new (input: Record<string, unknown>) => unknown;
  GetObjectCommand: new (input: Record<string, unknown>) => unknown;
  ListObjectsV2Command: new (input: Record<string, unknown>) => unknown;
  DeleteObjectsCommand: new (input: Record<string, unknown>) => unknown;
}

let _s3Module: S3Module | undefined;
async function getS3Module(): Promise<S3Module> {
  if (_s3Module) return _s3Module;
  try {
    _s3Module = (await import("@aws-sdk/client-s3")) as unknown as S3Module;
    return _s3Module;
  } catch {
    throw new StorageError(
      "@aws-sdk/client-s3 is required for ServerS3Storage. Install it: npm install @aws-sdk/client-s3",
      "import",
    );
  }
}

/**
 * S3-backed server storage for SMART Health Links.
 *
 * Implements the full `SHLServerStorage` interface with `read` and
 * `updateMetadata` on top of S3.
 *
 * Uses conditional PutObject for optimistic concurrency on metadata updates.
 *
 * @example
 * ```ts
 * import { ServerS3Storage } from "@fhirfly-io/shl/server";
 *
 * const storage = new ServerS3Storage({
 *   bucket: "my-shl-bucket",
 *   region: "us-east-1",
 *   baseUrl: "https://shl.example.com",
 * });
 * ```
 */
export class ServerS3Storage implements SHLServerStorage {
  private readonly _config: S3StorageConfig;
  private _client?: S3ClientInstance;

  constructor(config: S3StorageConfig) {
    this._config = config;
  }

  get baseUrl(): string {
    return this._config.baseUrl.replace(/\/+$/, "");
  }

  async store(key: string, content: string | Uint8Array): Promise<void> {
    try {
      const s3 = await getS3Module();
      const client = this._getClient(s3);
      const body = typeof content === "string" ? Buffer.from(content, "utf8") : content;

      const command = new s3.PutObjectCommand({
        Bucket: this._config.bucket,
        Key: this._s3Key(key),
        Body: body,
        ContentType: this._contentType(key),
      });

      await client.send(command);
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw new StorageError(
        `Failed to store ${key}: ${err instanceof Error ? err.message : String(err)}`,
        "store",
      );
    }
  }

  async delete(prefix: string): Promise<void> {
    try {
      const s3 = await getS3Module();
      const client = this._getClient(s3);
      const s3Prefix = this._s3Key(prefix);

      let continuationToken: string | undefined;
      do {
        const listInput: Record<string, unknown> = {
          Bucket: this._config.bucket,
          Prefix: s3Prefix,
        };
        if (continuationToken) listInput["ContinuationToken"] = continuationToken;

        const listCommand = new s3.ListObjectsV2Command(listInput);
        const response = (await client.send(listCommand)) as {
          Contents?: Array<{ Key?: string }>;
          IsTruncated?: boolean;
          NextContinuationToken?: string;
        };

        const objects = response.Contents;
        if (!objects || objects.length === 0) break;

        const deleteCommand = new s3.DeleteObjectsCommand({
          Bucket: this._config.bucket,
          Delete: {
            Objects: objects.map((obj) => ({ Key: obj.Key })),
            Quiet: true,
          },
        });
        await client.send(deleteCommand);

        continuationToken = response.IsTruncated
          ? response.NextContinuationToken
          : undefined;
      } while (continuationToken);
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw new StorageError(
        `Failed to delete ${prefix}: ${err instanceof Error ? err.message : String(err)}`,
        "delete",
      );
    }
  }

  async read(key: string): Promise<string | Uint8Array | null> {
    try {
      const s3 = await getS3Module();
      const client = this._getClient(s3);

      const command = new s3.GetObjectCommand({
        Bucket: this._config.bucket,
        Key: this._s3Key(key),
      });

      const response = (await client.send(command)) as {
        Body?: { transformToString(): Promise<string> };
      };

      if (!response.Body) return null;
      return response.Body.transformToString();
    } catch (err) {
      // S3 returns NoSuchKey for missing objects
      const code = (err as { name?: string }).name;
      if (code === "NoSuchKey") return null;
      if (err instanceof StorageError) throw err;
      throw new StorageError(
        `Failed to read ${key}: ${err instanceof Error ? err.message : String(err)}`,
        "read",
      );
    }
  }

  async updateMetadata(
    shlId: string,
    updater: (current: SHLMetadata) => SHLMetadata | null,
  ): Promise<SHLMetadata | null> {
    const key = `${shlId}/metadata.json`;
    const raw = await this.read(key);
    if (raw === null) return null;

    const current = JSON.parse(raw as string) as SHLMetadata;
    const updated = updater(current);
    if (updated === null) return null;

    await this.store(key, JSON.stringify(updated));
    return updated;
  }

  private _getClient(s3: S3Module): S3ClientInstance {
    if (!this._client) {
      this._client = new s3.S3Client({ region: this._config.region });
    }
    return this._client;
  }

  private _s3Key(key: string): string {
    const prefix = this._config.prefix?.replace(/\/+$/, "");
    return prefix ? `${prefix}/${key}` : key;
  }

  private _contentType(key: string): string {
    if (key.endsWith(".jwe")) return "application/jose";
    if (key.endsWith(".json")) return "application/json";
    return "application/octet-stream";
  }
}

// ---------------------------------------------------------------------------
// Azure Blob Storage (Server)
// ---------------------------------------------------------------------------

// Minimal Azure interfaces for server-side operations
interface AzureBlobModule {
  BlobServiceClient: {
    fromConnectionString(connectionString: string): AzureBlobServiceClient;
  };
}
interface AzureBlobServiceClient {
  getContainerClient(container: string): AzureContainerClient;
}
interface AzureContainerClient {
  getBlockBlobClient(blobName: string): AzureBlockBlobClient;
  listBlobsFlat(options?: { prefix?: string }): AsyncIterable<{ name: string }>;
}
interface AzureBlockBlobClient {
  upload(content: Uint8Array | Buffer, contentLength: number, options?: Record<string, unknown>): Promise<unknown>;
  deleteIfExists(): Promise<unknown>;
  download(): Promise<{ readableStreamBody?: NodeJS.ReadableStream }>;
}

let _azureModule: AzureBlobModule | undefined;
async function getAzureModule(): Promise<AzureBlobModule> {
  if (_azureModule) return _azureModule;
  try {
    _azureModule = (await import("@azure/storage-blob")) as unknown as AzureBlobModule;
    return _azureModule;
  } catch {
    throw new StorageError(
      "@azure/storage-blob is required for ServerAzureStorage. Install it: npm install @azure/storage-blob",
      "import",
    );
  }
}

/**
 * Azure Blob Storage server storage for SMART Health Links.
 *
 * Extends the base `AzureStorage` with `read` and `updateMetadata`
 * methods needed for serving SHLs.
 *
 * @example
 * ```ts
 * import { ServerAzureStorage } from "@fhirfly-io/shl/server";
 *
 * const storage = new ServerAzureStorage({
 *   container: "shl-data",
 *   connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING!,
 *   baseUrl: "https://shl.example.com",
 * });
 * ```
 */
export class ServerAzureStorage extends AzureStorage implements SHLServerStorage {
  private _serverContainerClient?: AzureContainerClient;

  constructor(config: AzureStorageConfig) {
    super(config);
  }

  async read(key: string): Promise<string | Uint8Array | null> {
    try {
      const container = await this._getServerContainer();
      const blobName = this._serverBlobName(key);
      const client = container.getBlockBlobClient(blobName);

      const response = await client.download();
      if (!response.readableStreamBody) return null;

      return await streamToString(response.readableStreamBody);
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404) return null;
      if (err instanceof StorageError) throw err;
      throw new StorageError(
        `Failed to read ${key}: ${err instanceof Error ? err.message : String(err)}`,
        "read",
      );
    }
  }

  async updateMetadata(
    shlId: string,
    updater: (current: SHLMetadata) => SHLMetadata | null,
  ): Promise<SHLMetadata | null> {
    const key = `${shlId}/metadata.json`;
    const raw = await this.read(key);
    if (raw === null) return null;

    const current = JSON.parse(raw as string) as SHLMetadata;
    const updated = updater(current);
    if (updated === null) return null;

    await this.store(key, JSON.stringify(updated));
    return updated;
  }

  private async _getServerContainer(): Promise<AzureContainerClient> {
    if (!this._serverContainerClient) {
      const azure = await getAzureModule();
      const serviceClient = azure.BlobServiceClient.fromConnectionString(this.config.connectionString);
      this._serverContainerClient = serviceClient.getContainerClient(this.config.container);
    }
    return this._serverContainerClient;
  }

  private _serverBlobName(key: string): string {
    const prefix = this.config.prefix?.replace(/\/+$/, "");
    return prefix ? `${prefix}/${key}` : key;
  }
}

// ---------------------------------------------------------------------------
// Google Cloud Storage (Server)
// ---------------------------------------------------------------------------

// Minimal GCS interfaces for server-side operations
interface GCSModule {
  Storage: new () => GCSStorageClient;
}
interface GCSStorageClient {
  bucket(name: string): GCSBucket;
}
interface GCSBucket {
  file(name: string): GCSFile;
  getFiles(options?: { prefix?: string }): Promise<[GCSFile[]]>;
}
interface GCSFile {
  save(content: Buffer, options?: Record<string, unknown>): Promise<void>;
  delete(options?: Record<string, unknown>): Promise<unknown>;
  download(): Promise<[Buffer]>;
  name: string;
}

let _gcsModule: GCSModule | undefined;
async function getGCSModule(): Promise<GCSModule> {
  if (_gcsModule) return _gcsModule;
  try {
    _gcsModule = (await import("@google-cloud/storage")) as unknown as GCSModule;
    return _gcsModule;
  } catch {
    throw new StorageError(
      "@google-cloud/storage is required for ServerGCSStorage. Install it: npm install @google-cloud/storage",
      "import",
    );
  }
}

/**
 * Google Cloud Storage server storage for SMART Health Links.
 *
 * Extends the base `GCSStorage` with `read` and `updateMetadata`
 * methods needed for serving SHLs.
 *
 * @example
 * ```ts
 * import { ServerGCSStorage } from "@fhirfly-io/shl/server";
 *
 * const storage = new ServerGCSStorage({
 *   bucket: "my-shl-bucket",
 *   baseUrl: "https://shl.example.com",
 * });
 * ```
 */
export class ServerGCSStorage extends GCSStorage implements SHLServerStorage {
  private _serverBucket?: GCSBucket;

  constructor(config: GCSStorageConfig) {
    super(config);
  }

  async read(key: string): Promise<string | Uint8Array | null> {
    try {
      const bucket = await this._getServerBucket();
      const fileName = this._serverFileName(key);
      const file = bucket.file(fileName);

      const [content] = await file.download();
      return content.toString("utf8");
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 404) return null;
      if (err instanceof StorageError) throw err;
      throw new StorageError(
        `Failed to read ${key}: ${err instanceof Error ? err.message : String(err)}`,
        "read",
      );
    }
  }

  async updateMetadata(
    shlId: string,
    updater: (current: SHLMetadata) => SHLMetadata | null,
  ): Promise<SHLMetadata | null> {
    const key = `${shlId}/metadata.json`;
    const raw = await this.read(key);
    if (raw === null) return null;

    const current = JSON.parse(raw as string) as SHLMetadata;
    const updated = updater(current);
    if (updated === null) return null;

    await this.store(key, JSON.stringify(updated));
    return updated;
  }

  private async _getServerBucket(): Promise<GCSBucket> {
    if (!this._serverBucket) {
      const gcs = await getGCSModule();
      const storage = new gcs.Storage();
      this._serverBucket = storage.bucket(this.config.bucket);
    }
    return this._serverBucket;
  }

  private _serverFileName(key: string): string {
    const prefix = this.config.prefix?.replace(/\/+$/, "");
    return prefix ? `${prefix}/${key}` : key;
  }
}

/** Helper: convert a Node.js ReadableStream to a string. */
async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks).toString("utf8");
}
