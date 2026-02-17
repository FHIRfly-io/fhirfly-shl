import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { LocalStorage } from "../shl/storage.js";
import type { LocalStorageConfig, S3StorageConfig } from "../shl/storage.js";
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
