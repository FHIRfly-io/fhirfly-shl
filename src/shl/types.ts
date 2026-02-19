// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
/**
 * Options for creating a SMART Health Link.
 */
export interface SHLOptions {
  /** The FHIR Bundle to share (as a JSON object) */
  bundle: Record<string, unknown>;
  /** Additional files to include (e.g., PDF documents, SMART Health Cards) */
  attachments?: SHLAttachment[];
  /** Optional passcode to protect the link */
  passcode?: string;
  /** Expiration date for the link */
  expiresAt?: Date;
  /** Maximum number of times the link can be accessed */
  maxAccesses?: number;
  /** Label for the SHL (shown in viewer apps, max 80 chars) */
  label?: string;
  /** Storage backend to use */
  storage: SHLStorage;
  /** Save unencrypted bundle alongside encrypted JWE (development only — do not use in production) */
  debug?: boolean;
}

/**
 * An additional file to include in the SHL manifest.
 */
export interface SHLAttachment {
  /** MIME content type (e.g., "application/pdf") */
  contentType: string;
  /** File content — string for text, Uint8Array for binary */
  content: string | Uint8Array;
}

/**
 * Result of creating a SMART Health Link.
 */
export interface SHLResult {
  /** The full SHL URL (shlink:/ protocol) */
  url: string;
  /** QR code as a PNG data URI (data:image/png;base64,...) */
  qrCode: string;
  /** The passcode (if one was set) */
  passcode?: string;
  /** Unique identifier for the SHL */
  id: string;
  /** When the link expires */
  expiresAt?: Date;
  /** Path to the unencrypted bundle (only set when debug mode is enabled) */
  debugBundlePath?: string;
}

/**
 * SHL manifest file entry.
 *
 * Entries may use `location` (URL to fetch content) or `embedded` (inline JWE).
 * Use `SHL.getEntryContent()` to handle both patterns transparently.
 */
export interface ManifestEntry {
  /** MIME type of the content (e.g., "application/fhir+json", "application/pdf") */
  contentType: string;
  /** URL to retrieve the content */
  location?: string;
  /** Embedded content (base64url-encoded if encrypted) */
  embedded?: string;
}

/**
 * SHL manifest file.
 */
export interface Manifest {
  /** Array of files available via this SHL */
  files: ManifestEntry[];
  /** Manifest status per SHL spec: "finalized", "can-change", or "no-longer-valid" */
  status?: "finalized" | "can-change" | "no-longer-valid";
  /** ISO 8601 timestamp of when the manifest was last updated */
  lastUpdated?: string;
}

/**
 * Metadata stored alongside an SHL for access control.
 */
export interface SHLMetadata {
  /** Passcode required to access the link */
  passcode?: string;
  /** Maximum number of times the link can be accessed */
  maxAccesses?: number;
  /** Number of times the link has been accessed */
  accessCount?: number;
  /** ISO 8601 expiration date */
  expiresAt?: string;
  /** ISO 8601 creation date */
  createdAt: string;
}

/**
 * Interface for SHL storage backends.
 *
 * Storage backends write files to a location (filesystem, S3, etc.).
 * The user configures their own server to serve these files via `baseUrl`.
 */
export interface SHLStorage {
  /** Base URL of the user's SHL server. Used to compute manifest and content URLs. */
  readonly baseUrl: string;

  /** Store content at the given key path. */
  store(key: string, content: string | Uint8Array): Promise<void>;

  /** Delete all files for an SHL by prefix. */
  delete(prefix: string): Promise<void>;
}
