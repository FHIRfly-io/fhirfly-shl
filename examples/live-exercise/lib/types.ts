// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

import type { Runner } from "./runner.js";
import type { SHLStorage, SHLResult } from "../../../src/shl/types.js";
import type { FhirflyClient } from "../../../src/ips/types.js";

/**
 * Shared context threaded through all exercise sections.
 *
 * Each section may read from or write to this context so that later sections
 * can consume artifacts produced by earlier ones (e.g., the FHIR bundle built
 * in section 1 is used by sections 2-6).
 */
export interface ExerciseContext {
  /** FHIRfly API key */
  apiKey: string;

  /** FHIRfly API base URL */
  apiBaseUrl: string;

  /** Terminology client (duck-typed FhirflyClient) */
  client: FhirflyClient;

  /** Test runner instance */
  runner: Runner;

  /** Verbose output flag */
  verbose: boolean;

  /** Skip cleanup (don't revoke SHLs) */
  skipCleanup: boolean;

  // --- Artifacts set by sections ---

  /** FHIR Bundle built by section 1 */
  fhirBundle?: Record<string, unknown>;

  /** SHL result from section 2 (FhirflyStorage) */
  fhirflyShlResult?: SHLResult;

  /** FhirflyStorage instance from section 2 */
  fhirflyStorage?: SHLStorage;

  /** SHL result from section 3 (LocalStorage) */
  localShlResult?: SHLResult;

  /** All SHL IDs created during the exercise (for cleanup) */
  createdShlIds: Array<{ id: string; storage: SHLStorage }>;
}
