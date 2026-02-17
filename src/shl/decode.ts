import { base64urlDecode, decryptBundle } from "./crypto.js";
import { ValidationError, EncryptionError } from "../errors.js";

/**
 * A decoded SMART Health Link payload.
 *
 * Contains all fields from the shlink:/ URL payload,
 * parsed and ready for use.
 */
export interface DecodedSHL {
  /** Manifest URL — POST here to retrieve the manifest */
  url: string;
  /** Decryption key (32 bytes) */
  key: Buffer;
  /** SHL flags (e.g., "L", "LP") */
  flag: string;
  /** SHL version (currently always 1) */
  v: number;
  /** Expiration as epoch seconds (undefined if no expiration) */
  exp?: number;
  /** Human-readable label (max 80 chars) */
  label?: string;
}

/**
 * Decode a `shlink:/` URL into its constituent parts.
 *
 * Extracts the manifest URL, decryption key, flags, version,
 * optional expiration, and optional label from the SHL payload.
 *
 * @example
 * ```ts
 * const decoded = SHL.decode("shlink:/eyJ1cmw...");
 * // decoded.url   → "https://shl.example.com/{shlId}"
 * // decoded.key   → Buffer (32 bytes)
 * // decoded.flag  → "LP"
 * // decoded.exp   → 1798761600 (or undefined)
 * // decoded.label → "Jane's IPS" (or undefined)
 * ```
 */
export function decode(url: string): DecodedSHL {
  if (!url || typeof url !== "string") {
    throw new ValidationError("url is required and must be a string");
  }

  if (!url.startsWith("shlink:/")) {
    throw new ValidationError(
      `Invalid SHL URL: must start with "shlink:/", got "${url.slice(0, 20)}..."`,
    );
  }

  const b64 = url.slice("shlink:/".length);
  if (!b64) {
    throw new ValidationError("Invalid SHL URL: empty payload");
  }

  let payload: Record<string, unknown>;
  try {
    const json = base64urlDecode(b64).toString("utf8");
    payload = JSON.parse(json) as Record<string, unknown>;
  } catch {
    throw new ValidationError("Invalid SHL URL: could not decode payload");
  }

  // Validate required fields
  if (!payload["url"] || typeof payload["url"] !== "string") {
    throw new ValidationError("Invalid SHL payload: missing or invalid 'url'");
  }
  if (!payload["key"] || typeof payload["key"] !== "string") {
    throw new ValidationError("Invalid SHL payload: missing or invalid 'key'");
  }
  if (!payload["flag"] || typeof payload["flag"] !== "string") {
    throw new ValidationError("Invalid SHL payload: missing or invalid 'flag'");
  }

  const key = base64urlDecode(payload["key"] as string);
  if (key.length !== 32) {
    throw new ValidationError(
      `Invalid SHL payload: key must be 32 bytes, got ${key.length}`,
    );
  }

  return {
    url: payload["url"] as string,
    key,
    flag: payload["flag"] as string,
    v: typeof payload["v"] === "number" ? payload["v"] : 1,
    exp: typeof payload["exp"] === "number" ? payload["exp"] : undefined,
    label: typeof payload["label"] === "string" ? payload["label"] : undefined,
  };
}

/**
 * Decrypt a JWE compact serialization back to a FHIR bundle.
 *
 * This is a convenience wrapper around the internal `decryptBundle` function,
 * exposed as a public API for consuming SHLs.
 *
 * @param jwe - JWE compact serialization string (5 dot-separated parts)
 * @param key - 32-byte AES-256 key (from `SHL.decode().key`)
 * @returns The decrypted FHIR bundle as a JSON object
 *
 * @example
 * ```ts
 * const decoded = SHL.decode("shlink:/eyJ1cmw...");
 * const manifest = await fetch(decoded.url, {
 *   method: "POST",
 *   headers: { "content-type": "application/json" },
 *   body: JSON.stringify({ passcode: "1234" }),
 * }).then(r => r.json());
 *
 * const jwe = await fetch(manifest.files[0].location).then(r => r.text());
 * const bundle = SHL.decrypt(jwe, decoded.key);
 * ```
 */
export function decrypt(
  jwe: string,
  key: Buffer,
): Record<string, unknown> {
  if (!jwe || typeof jwe !== "string") {
    throw new EncryptionError("jwe is required and must be a string");
  }
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new EncryptionError("key must be a 32-byte Buffer");
  }

  try {
    return decryptBundle(jwe, key);
  } catch (err) {
    if (err instanceof EncryptionError) throw err;
    throw new EncryptionError(
      `Failed to decrypt: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
