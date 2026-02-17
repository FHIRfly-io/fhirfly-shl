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
