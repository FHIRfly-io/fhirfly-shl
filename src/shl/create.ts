// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import type { SHLOptions, SHLResult, Manifest, SHLMetadata } from "./types.js";
import { ValidationError, StorageError, EncryptionError } from "../errors.js";
import { generateKey, generateShlId, encryptBundle, encryptContent, base64url } from "./crypto.js";
import { generateQRCode } from "./qrcode.js";
import { createHash } from "node:crypto";

/**
 * Create a SMART Health Link from a FHIR Bundle.
 *
 * Encrypts the bundle, stores it using the provided storage backend,
 * and returns a SHL URL with an embedded QR code.
 *
 * This implements manifest mode only (`L` flag always set).
 * The user's server is responsible for serving the manifest and content
 * files from the storage backend.
 *
 * @example
 * ```ts
 * const result = await SHL.create({
 *   bundle: fhirBundle,
 *   passcode: "1234",
 *   expiresAt: new Date("2025-12-31"),
 *   storage: new SHL.LocalStorage({
 *     directory: "./shl-data",
 *     baseUrl: "https://shl.example.com",
 *   }),
 * });
 *
 * console.log(result.url);    // shlink:/...
 * console.log(result.qrCode); // data:image/png;base64,...
 * ```
 */
export async function create(options: SHLOptions): Promise<SHLResult> {
  const { bundle, passcode, expiresAt, maxAccesses, label, storage, debug } = options;

  // Validate inputs
  if (!bundle || typeof bundle !== "object") {
    throw new ValidationError("bundle is required and must be an object");
  }
  if (!storage?.baseUrl) {
    throw new ValidationError("storage with baseUrl is required");
  }

  // Generate key and ID
  const key = generateKey();
  const shlId = generateShlId();

  // Encrypt bundle → JWE compact
  let jwe: string;
  try {
    jwe = encryptBundle(bundle, key);
  } catch (err) {
    throw new EncryptionError(
      `Failed to encrypt bundle: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Strip trailing slashes from baseUrl
  const baseUrl = storage.baseUrl.replace(/\/+$/, "");

  // Store content.jwe
  try {
    await storage.store(`${shlId}/content.jwe`, jwe);
  } catch (err) {
    throw new StorageError(
      `Failed to store content: ${err instanceof Error ? err.message : String(err)}`,
      "store",
    );
  }

  // Store unencrypted bundle for debugging (development only)
  if (debug) {
    if (typeof process !== "undefined" && process.env?.NODE_ENV === "production") {
      throw new ValidationError(
        "debug mode is not allowed when NODE_ENV=production — it stores unencrypted PHI",
      );
    }
    const debugPath = `${shlId}/bundle.json`;
    try {
      await storage.store(debugPath, JSON.stringify(bundle, null, 2));
    } catch (err) {
      throw new StorageError(
        `Failed to store debug bundle: ${err instanceof Error ? err.message : String(err)}`,
        "store",
      );
    }
    console.warn(
      `[SHL] Debug mode: unencrypted bundle saved to ${debugPath} — do not use in production`,
    );
  }

  // Encrypt and store attachments
  const attachments = options.attachments ?? [];
  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i]!;
    const attData = typeof att.content === "string"
      ? Buffer.from(att.content, "utf8")
      : Buffer.from(att.content);
    let attJwe: string;
    try {
      attJwe = encryptContent(attData, key, att.contentType);
    } catch (err) {
      throw new EncryptionError(
        `Failed to encrypt attachment ${i}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    try {
      await storage.store(`${shlId}/attachment-${i}.jwe`, attJwe);
    } catch (err) {
      throw new StorageError(
        `Failed to store attachment ${i}: ${err instanceof Error ? err.message : String(err)}`,
        "store",
      );
    }
  }

  // Build and store manifest
  const manifest: Manifest = {
    files: [
      {
        contentType: "application/fhir+json;fhirVersion=4.0.1",
        location: `${baseUrl}/${shlId}/content`,
      },
      ...attachments.map((att, i) => ({
        contentType: att.contentType,
        location: `${baseUrl}/${shlId}/attachment/${i}`,
      })),
    ],
    status: "finalized",
  };

  try {
    await storage.store(`${shlId}/manifest.json`, JSON.stringify(manifest));
  } catch (err) {
    throw new StorageError(
      `Failed to store manifest: ${err instanceof Error ? err.message : String(err)}`,
      "store",
    );
  }

  // Build and store metadata
  const metadata: SHLMetadata = {
    createdAt: new Date().toISOString(),
  };
  if (passcode) {
    metadata.passcode = createHash("sha256").update(passcode).digest("hex");
  }
  if (maxAccesses !== undefined) metadata.maxAccesses = maxAccesses;
  if (expiresAt) metadata.expiresAt = expiresAt.toISOString();

  try {
    await storage.store(`${shlId}/metadata.json`, JSON.stringify(metadata));
  } catch (err) {
    throw new StorageError(
      `Failed to store metadata: ${err instanceof Error ? err.message : String(err)}`,
      "store",
    );
  }

  // Build SHL payload
  const flags = buildFlags(passcode);
  const shlPayload: Record<string, unknown> = {
    url: `${baseUrl}/${shlId}`,
    key: base64url(key),
    flag: flags,
    v: 1,
  };

  if (expiresAt) {
    shlPayload["exp"] = Math.floor(expiresAt.getTime() / 1000);
  }

  if (label) {
    shlPayload["label"] = label.length > 80 ? label.slice(0, 80) : label;
  }

  // Build shlink:/ URL
  const payloadJson = JSON.stringify(shlPayload);
  const payloadB64 = base64url(Buffer.from(payloadJson, "utf8"));
  const shlUrl = `shlink:/${payloadB64}`;

  // Generate QR code
  const qrCode = await generateQRCode(shlUrl);

  const result: SHLResult = {
    url: shlUrl,
    qrCode,
    id: shlId,
  };

  if (passcode) result.passcode = passcode;
  if (expiresAt) result.expiresAt = expiresAt;
  if (debug) result.debugBundlePath = `${shlId}/bundle.json`;

  return result;
}

/**
 * Build the SHL flags string. Flags are alphabetically sorted.
 * `L` is always set (manifest mode). `P` is set if a passcode is provided.
 */
function buildFlags(passcode?: string): string {
  const flags: string[] = ["L"];
  if (passcode) flags.push("P");
  return flags.sort().join("");
}
