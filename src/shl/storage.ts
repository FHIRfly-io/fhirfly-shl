// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SHLStorage } from "./types.js";
import { StorageError } from "../errors.js";

/**
 * Configuration for local filesystem SHL storage.
 */
export interface LocalStorageConfig {
  /** Directory path for storing SHL files */
  directory: string;
  /** Base URL for serving the files (trailing slashes are stripped) */
  baseUrl: string;
}

/**
 * Local filesystem storage for SMART Health Links.
 * Useful for development and testing.
 *
 * Files are written to `{directory}/{key}`. The user's server
 * maps `{baseUrl}/{shlId}` to reads from this directory.
 *
 * @example
 * ```ts
 * const storage = new SHL.LocalStorage({
 *   directory: "./shl-data",
 *   baseUrl: "http://localhost:3000/shl",
 * });
 * ```
 */
export class LocalStorage implements SHLStorage {
  private readonly _config: LocalStorageConfig;

  constructor(config: LocalStorageConfig) {
    this._config = config;
  }

  /** Returns the storage configuration. */
  get config(): LocalStorageConfig {
    return this._config;
  }

  /** Base URL with trailing slashes stripped. */
  get baseUrl(): string {
    return this._config.baseUrl.replace(/\/+$/, "");
  }

  async store(key: string, content: string | Uint8Array): Promise<void> {
    const filePath = join(this._config.directory, key);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }

  async delete(prefix: string): Promise<void> {
    const dirPath = join(this._config.directory, prefix);
    rmSync(dirPath, { recursive: true, force: true });
  }
}

/**
 * Configuration for S3-based SHL storage.
 */
export interface S3StorageConfig {
  /** S3 bucket name */
  bucket: string;
  /** AWS region */
  region: string;
  /** Optional key prefix */
  prefix?: string;
  /** Base URL for serving the files */
  baseUrl: string;
}

// Minimal interfaces for @aws-sdk/client-s3 (peer dependency)
interface S3ClientInstance {
  send(command: unknown): Promise<unknown>;
}
interface S3Module {
  S3Client: new (config: { region: string }) => S3ClientInstance;
  PutObjectCommand: new (input: Record<string, unknown>) => unknown;
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
      "@aws-sdk/client-s3 is required for S3Storage. Install it: npm install @aws-sdk/client-s3",
      "import",
    );
  }
}

/**
 * S3-backed storage for SMART Health Links.
 *
 * Requires `@aws-sdk/client-s3` as a peer dependency — install it separately:
 * ```
 * npm install @aws-sdk/client-s3
 * ```
 *
 * @example
 * ```ts
 * const storage = new SHL.S3Storage({
 *   bucket: "my-shl-bucket",
 *   region: "us-east-1",
 *   baseUrl: "https://shl.example.com",
 * });
 * ```
 */
export class S3Storage implements SHLStorage {
  private readonly _config: S3StorageConfig;
  private _client?: S3ClientInstance;

  constructor(config: S3StorageConfig) {
    this._config = config;
  }

  /** Returns the storage configuration. */
  get config(): S3StorageConfig {
    return this._config;
  }

  /** Base URL with trailing slashes stripped. */
  get baseUrl(): string {
    return this._config.baseUrl.replace(/\/+$/, "");
  }

  async store(key: string, content: string | Uint8Array): Promise<void> {
    try {
      const s3 = await getS3Module();
      const client = this._getClient(s3);
      const body =
        typeof content === "string" ? Buffer.from(content, "utf8") : content;

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
        if (continuationToken) {
          listInput["ContinuationToken"] = continuationToken;
        }

        const listCommand = new s3.ListObjectsV2Command(listInput);
        const response = (await client.send(listCommand)) as {
          Contents?: Array<{ Key?: string }>;
          IsTruncated?: boolean;
          NextContinuationToken?: string;
        };

        const objects = response.Contents;
        if (!objects || objects.length === 0) break;

        const deleteInput = {
          Bucket: this._config.bucket,
          Delete: {
            Objects: objects.map((obj) => ({ Key: obj.Key })),
            Quiet: true,
          },
        };

        const deleteCommand = new s3.DeleteObjectsCommand(deleteInput);
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
// Azure Blob Storage
// ---------------------------------------------------------------------------

/**
 * Configuration for Azure Blob Storage SHL storage.
 */
export interface AzureStorageConfig {
  /** Azure Blob Storage container name */
  container: string;
  /** Azure Storage connection string */
  connectionString: string;
  /** Base URL for serving the files */
  baseUrl: string;
  /** Optional key prefix */
  prefix?: string;
}

// Minimal interfaces for @azure/storage-blob (peer dependency)
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
}

let _azureModule: AzureBlobModule | undefined;
async function getAzureModule(): Promise<AzureBlobModule> {
  if (_azureModule) return _azureModule;
  try {
    _azureModule = (await import("@azure/storage-blob")) as unknown as AzureBlobModule;
    return _azureModule;
  } catch {
    throw new StorageError(
      "@azure/storage-blob is required for AzureStorage. Install it: npm install @azure/storage-blob",
      "import",
    );
  }
}

/**
 * Azure Blob Storage backend for SMART Health Links.
 *
 * Requires `@azure/storage-blob` as a peer dependency — install it separately:
 * ```
 * npm install @azure/storage-blob
 * ```
 *
 * @example
 * ```ts
 * const storage = new SHL.AzureStorage({
 *   container: "shl-data",
 *   connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING!,
 *   baseUrl: "https://shl.example.com",
 * });
 * ```
 */
export class AzureStorage implements SHLStorage {
  private readonly _config: AzureStorageConfig;
  private _containerClient?: AzureContainerClient;

  constructor(config: AzureStorageConfig) {
    this._config = config;
  }

  get config(): AzureStorageConfig {
    return this._config;
  }

  get baseUrl(): string {
    return this._config.baseUrl.replace(/\/+$/, "");
  }

  async store(key: string, content: string | Uint8Array): Promise<void> {
    try {
      const container = await this._getContainer();
      const blobName = this._blobName(key);
      const body = typeof content === "string" ? Buffer.from(content, "utf8") : content;
      const client = container.getBlockBlobClient(blobName);

      await client.upload(body, body.length, {
        blobHTTPHeaders: { blobContentType: this._contentType(key) },
      });
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
      const container = await this._getContainer();
      const blobPrefix = this._blobName(prefix);

      for await (const blob of container.listBlobsFlat({ prefix: blobPrefix })) {
        const client = container.getBlockBlobClient(blob.name);
        await client.deleteIfExists();
      }
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw new StorageError(
        `Failed to delete ${prefix}: ${err instanceof Error ? err.message : String(err)}`,
        "delete",
      );
    }
  }

  private async _getContainer(): Promise<AzureContainerClient> {
    if (!this._containerClient) {
      const azure = await getAzureModule();
      const serviceClient = azure.BlobServiceClient.fromConnectionString(this._config.connectionString);
      this._containerClient = serviceClient.getContainerClient(this._config.container);
    }
    return this._containerClient;
  }

  private _blobName(key: string): string {
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
// Google Cloud Storage
// ---------------------------------------------------------------------------

/**
 * Configuration for Google Cloud Storage SHL storage.
 */
export interface GCSStorageConfig {
  /** GCS bucket name */
  bucket: string;
  /** Base URL for serving the files */
  baseUrl: string;
  /** Optional key prefix */
  prefix?: string;
}

// Minimal interfaces for @google-cloud/storage (peer dependency)
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
      "@google-cloud/storage is required for GCSStorage. Install it: npm install @google-cloud/storage",
      "import",
    );
  }
}

/**
 * Google Cloud Storage backend for SMART Health Links.
 *
 * Requires `@google-cloud/storage` as a peer dependency — install it separately:
 * ```
 * npm install @google-cloud/storage
 * ```
 *
 * @example
 * ```ts
 * const storage = new SHL.GCSStorage({
 *   bucket: "my-shl-bucket",
 *   baseUrl: "https://shl.example.com",
 * });
 * ```
 */
export class GCSStorage implements SHLStorage {
  private readonly _config: GCSStorageConfig;
  private _bucket?: GCSBucket;

  constructor(config: GCSStorageConfig) {
    this._config = config;
  }

  get config(): GCSStorageConfig {
    return this._config;
  }

  get baseUrl(): string {
    return this._config.baseUrl.replace(/\/+$/, "");
  }

  async store(key: string, content: string | Uint8Array): Promise<void> {
    try {
      const bucket = await this._getBucket();
      const fileName = this._fileName(key);
      const body = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
      const file = bucket.file(fileName);

      await file.save(body, {
        contentType: this._contentType(key),
        resumable: false,
      });
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
      const bucket = await this._getBucket();
      const filePrefix = this._fileName(prefix);

      const [files] = await bucket.getFiles({ prefix: filePrefix });
      for (const file of files) {
        await file.delete({ ignoreNotFound: true });
      }
    } catch (err) {
      if (err instanceof StorageError) throw err;
      throw new StorageError(
        `Failed to delete ${prefix}: ${err instanceof Error ? err.message : String(err)}`,
        "delete",
      );
    }
  }

  private async _getBucket(): Promise<GCSBucket> {
    if (!this._bucket) {
      const gcs = await getGCSModule();
      const storage = new gcs.Storage();
      this._bucket = storage.bucket(this._config.bucket);
    }
    return this._bucket;
  }

  private _fileName(key: string): string {
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
// FHIRfly Hosted Storage
// ---------------------------------------------------------------------------

/**
 * Configuration for FHIRfly's hosted SHL storage service.
 */
export interface FhirflyStorageConfig {
  /** FHIRfly API key (X-API-Key header) */
  apiKey: string;
  /** FHIRfly API base URL (defaults to https://api.fhirfly.io) */
  apiBaseUrl?: string;
}

/**
 * FHIRfly hosted storage for SMART Health Links.
 *
 * Zero-infra option — encrypted content is stored on FHIRfly's servers.
 * The decryption key is NEVER sent to FHIRfly; it lives only in the `shlink:/` URL.
 * FHIRfly stores only opaque encrypted blobs.
 *
 * @example
 * ```ts
 * const storage = new SHL.FhirflyStorage({
 *   apiKey: process.env.FHIRFLY_API_KEY!,
 * });
 *
 * const result = await SHL.create({
 *   bundle: myFhirBundle,
 *   storage,
 * });
 * ```
 */
export class FhirflyStorage implements SHLStorage {
  private readonly _config: FhirflyStorageConfig;
  private readonly _apiBaseUrl: string;

  constructor(config: FhirflyStorageConfig) {
    this._config = config;
    this._apiBaseUrl = (config.apiBaseUrl || "https://api.fhirfly.io").replace(/\/+$/, "");
  }

  /** Returns the storage configuration. */
  get config(): FhirflyStorageConfig {
    return this._config;
  }

  /**
   * Base URL for manifest access (public endpoint).
   * Viewers POST to `{baseUrl}/{shlId}` to get the manifest.
   */
  get baseUrl(): string {
    return `${this._apiBaseUrl}/public/shl`;
  }

  async store(key: string, content: string | Uint8Array): Promise<void> {
    // Extract shlId from key path: "{shlId}/{filename}"
    const slashIdx = key.indexOf("/");
    if (slashIdx === -1) {
      throw new StorageError(`Invalid storage key format: "${key}" (expected "{shlId}/{filename}")`, "store");
    }
    const shlId = key.slice(0, slashIdx);
    const fileName = key.slice(slashIdx + 1);

    const body = typeof content === "string" ? content : Buffer.from(content);
    const contentType = fileName.endsWith(".json") ? "application/json" : "application/jose";

    const url = `${this._apiBaseUrl}/v1/shl/${encodeURIComponent(shlId)}/files/${encodeURIComponent(fileName)}`;
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "X-API-Key": this._config.apiKey,
        "Content-Type": contentType,
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new StorageError(
        `FHIRfly API error (${response.status}): ${text || response.statusText}`,
        "store",
      );
    }
  }

  async delete(prefix: string): Promise<void> {
    // prefix is "{shlId}/" — extract shlId
    const shlId = prefix.replace(/\/+$/, "");

    const url = `${this._apiBaseUrl}/v1/shl/${encodeURIComponent(shlId)}`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: {
        "X-API-Key": this._config.apiKey,
      },
    });

    if (!response.ok && response.status !== 404) {
      const text = await response.text().catch(() => "");
      throw new StorageError(
        `FHIRfly API error (${response.status}): ${text || response.statusText}`,
        "delete",
      );
    }
  }
}
