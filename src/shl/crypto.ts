// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

/** Encode a Buffer as base64url (RFC 4648). */
export function base64url(data: Buffer): string {
  return data.toString("base64url");
}

/** Decode a base64url string to a Buffer. */
export function base64urlDecode(str: string): Buffer {
  return Buffer.from(str, "base64url");
}

/** Generate a 32-byte AES-256 key. */
export function generateKey(): Buffer {
  return randomBytes(32);
}

/** Generate an SHL ID: 32 random bytes encoded as base64url (43 chars). */
export function generateShlId(): string {
  return base64url(randomBytes(32));
}

/**
 * Encrypt a FHIR bundle as a JWE compact serialization.
 *
 * Uses `alg: "dir"`, `enc: "A256GCM"`, `zip: "DEF"` as specified by the
 * SMART Health Links specification. The key is used directly as the Content
 * Encryption Key (no key wrapping).
 *
 * Pipeline: JSON.stringify → deflateRaw → AES-256-GCM → JWE compact
 *
 * JWE compact format: `header..iv.ciphertext.tag`
 * (empty encrypted key segment for alg: "dir")
 */
export function encryptBundle(
  bundle: Record<string, unknown>,
  key: Buffer,
): string {
  // 1. Serialize
  const json = JSON.stringify(bundle);

  // 2. Compress (raw DEFLATE, RFC 1951)
  const compressed = deflateRawSync(Buffer.from(json, "utf8"));

  // 3. Build JWE protected header
  const header = {
    alg: "dir",
    enc: "A256GCM",
    cty: "application/fhir+json",
    zip: "DEF",
  };
  const headerB64 = base64url(Buffer.from(JSON.stringify(header), "utf8"));

  // 4. Encrypt with AES-256-GCM
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  // AAD is the base64url-encoded protected header (ASCII bytes)
  cipher.setAAD(Buffer.from(headerB64, "ascii"));

  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();

  // 5. JWE compact serialization: header..iv.ciphertext.tag
  // Empty segment for encrypted key (alg: "dir" — key is used directly)
  return `${headerB64}..${base64url(iv)}.${base64url(ciphertext)}.${base64url(tag)}`;
}

/**
 * Encrypt arbitrary content as a JWE compact serialization.
 *
 * Uses `alg: "dir"`, `enc: "A256GCM"`, `zip: "DEF"`.
 * The `contentType` is stored in the JWE `cty` header so the
 * recipient knows how to interpret the decrypted payload.
 *
 * Pipeline: content bytes → deflateRaw → AES-256-GCM → JWE compact
 */
export function encryptContent(
  data: Buffer,
  key: Buffer,
  contentType: string,
): string {
  const compressed = deflateRawSync(data);
  const header = { alg: "dir", enc: "A256GCM", cty: contentType, zip: "DEF" };
  const headerB64 = base64url(Buffer.from(JSON.stringify(header), "utf8"));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(headerB64, "ascii"));
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${headerB64}..${base64url(iv)}.${base64url(ciphertext)}.${base64url(tag)}`;
}

/**
 * Decrypt a JWE compact serialization to raw bytes and content type.
 *
 * Pipeline: parse JWE → AES-256-GCM decrypt → inflateRaw → Buffer
 */
export function decryptContent(
  jwe: string,
  key: Buffer,
): { contentType: string; data: Buffer } {
  const parts = jwe.split(".");
  if (parts.length !== 5) {
    throw new Error(`Invalid JWE compact serialization: expected 5 parts, got ${parts.length}`);
  }
  const [headerB64, , ivB64, ciphertextB64, tagB64] = parts as [string, string, string, string, string];
  const header = JSON.parse(base64urlDecode(headerB64!).toString("utf8")) as Record<string, string>;
  if (header["alg"] !== "dir" || header["enc"] !== "A256GCM") {
    throw new Error(`Unsupported JWE: alg=${header["alg"]}, enc=${header["enc"]}`);
  }
  const iv = base64urlDecode(ivB64!);
  const ciphertext = base64urlDecode(ciphertextB64!);
  const tag = base64urlDecode(tagB64!);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(headerB64!, "ascii"));
  decipher.setAuthTag(tag);
  const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  const data = header["zip"] === "DEF" ? inflateRawSync(compressed) : compressed;
  return { contentType: header["cty"] ?? "application/octet-stream", data: Buffer.from(data) };
}

/**
 * Decrypt a JWE compact serialization back to a FHIR bundle.
 *
 * Pipeline: parse JWE → AES-256-GCM decrypt → inflateRaw → JSON.parse
 */
export function decryptBundle(
  jwe: string,
  key: Buffer,
): Record<string, unknown> {
  const parts = jwe.split(".");
  if (parts.length !== 5) {
    throw new Error(`Invalid JWE compact serialization: expected 5 parts, got ${parts.length}`);
  }

  const [headerB64, , ivB64, ciphertextB64, tagB64] = parts as [string, string, string, string, string];

  // Verify header
  const header = JSON.parse(base64urlDecode(headerB64!).toString("utf8")) as Record<string, string>;
  if (header["alg"] !== "dir" || header["enc"] !== "A256GCM") {
    throw new Error(`Unsupported JWE: alg=${header["alg"]}, enc=${header["enc"]}`);
  }

  const iv = base64urlDecode(ivB64!);
  const ciphertext = base64urlDecode(ciphertextB64!);
  const tag = base64urlDecode(tagB64!);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(headerB64!, "ascii"));
  decipher.setAuthTag(tag);

  const compressed = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  // Decompress if zip: "DEF"
  const json = header["zip"] === "DEF"
    ? inflateRawSync(compressed).toString("utf8")
    : compressed.toString("utf8");

  return JSON.parse(json) as Record<string, unknown>;
}
