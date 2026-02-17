// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import type { SHLStorage } from "./types.js";

/**
 * Revoke a SMART Health Link by deleting all stored files.
 *
 * Removes the encrypted content, manifest, and metadata from storage.
 * After revocation, the SHL URL and QR code will no longer work —
 * viewers will receive a 404 when attempting to access the manifest.
 *
 * @param shlId - The SHL identifier (from `SHLResult.id`)
 * @param storage - The storage backend where the SHL files are stored
 */
export async function revoke(
  shlId: string,
  storage: SHLStorage
): Promise<void> {
  if (!shlId) {
    throw new Error("shlId is required");
  }
  await storage.delete(shlId);
}
