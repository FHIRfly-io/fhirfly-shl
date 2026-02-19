// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import type { SHLStorage, SHLMetadata } from "../shl/types.js";

/**
 * Framework-agnostic incoming request.
 */
export interface HandlerRequest {
  /** HTTP method (uppercase) */
  method: string;
  /** Path relative to mount point, e.g., "/{shlId}" or "/{shlId}/content" */
  path: string;
  /** Parsed JSON body (for POST requests) */
  body?: unknown;
  /** Request headers (lowercase keys) */
  headers: Record<string, string | undefined>;
}

/**
 * Framework-agnostic outgoing response.
 */
export interface HandlerResponse {
  /** HTTP status code */
  status: number;
  /** Response headers */
  headers: Record<string, string>;
  /** Response body (string for JSON, Uint8Array for binary) */
  body: string | Uint8Array;
}

/**
 * Extended storage interface for server-side operations.
 *
 * Adds `read` and `updateMetadata` to the base `SHLStorage` interface.
 * Server storage needs to read files and atomically update metadata
 * (e.g., increment access counts).
 */
export interface SHLServerStorage extends SHLStorage {
  /** Read a file by key. Returns null if not found. */
  read(key: string): Promise<string | Uint8Array | null>;

  /**
   * Atomically read-modify-write metadata for an SHL.
   *
   * The `updater` function receives the current metadata and returns
   * the updated metadata (or `null` to signal no update should occur).
   *
   * @param shlId - The SHL identifier
   * @param updater - Function that transforms metadata
   * @returns The updated metadata, or null if the SHL was not found or updater returned null
   */
  updateMetadata(
    shlId: string,
    updater: (current: SHLMetadata) => SHLMetadata | null,
  ): Promise<SHLMetadata | null>;
}

/**
 * CORS configuration for the SHL server handler.
 *
 * By default, the handler adds permissive CORS headers to all responses
 * so that browser-based SHL viewers can access self-hosted servers.
 * Set `cors: false` to disable, or provide an object to customize.
 */
export interface CorsConfig {
  /** Allowed origin(s). Default: `"*"` */
  origin?: string;
  /** Allowed methods. Default: `"GET, POST, OPTIONS"` */
  methods?: string;
  /** Allowed headers. Default: `"Content-Type, Authorization"` */
  headers?: string;
}

/**
 * Configuration for the SHL server handler.
 */
export interface SHLHandlerConfig {
  /** Server storage backend (must implement SHLServerStorage) */
  storage: SHLServerStorage;

  /**
   * Optional callback invoked on each successful manifest access.
   * Useful for logging, analytics, or custom access control.
   */
  onAccess?: (event: AccessEvent) => void | Promise<void>;

  /**
   * CORS configuration. Defaults to permissive headers (`Access-Control-Allow-Origin: *`).
   * Set to `false` to disable CORS headers entirely.
   */
  cors?: CorsConfig | false;
}

/**
 * Event emitted on each successful manifest access.
 */
export interface AccessEvent {
  /** The SHL identifier */
  shlId: string;
  /** Current access count (after increment) */
  accessCount: number;
  /** Timestamp of the access */
  timestamp: Date;
}
