// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
/**
 * @fhirfly-io/shl - Official FHIRfly SDK for SMART Health Links
 *
 * Create IPS (International Patient Summary) FHIR bundles and share them
 * via SMART Health Links (SHL).
 *
 * @packageDocumentation
 */

// IPS namespace
export * as IPS from "./ips/index.js";

// SHL namespace
export * as SHL from "./shl/index.js";

// Re-export SHLStorage interface at top level for convenience
export type { SHLStorage } from "./shl/types.js";

// Errors
export { ShlError, ValidationError, StorageError, EncryptionError } from "./errors.js";
