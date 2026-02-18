// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * FHIRfly SHL SDK — Live Exercise
 *
 * Comprehensive integration test that exercises every SDK path against
 * the live FHIRfly API. Serves as both a smoke test and living documentation.
 *
 * Usage:
 *   npx tsx examples/live-exercise/index.ts --api-key <key>
 *   npx tsx examples/live-exercise/index.ts --api-key <key> --section 1 --verbose
 */

import { Command } from "commander";
import { Fhirfly } from "@fhirfly-io/terminology";
import { SHL } from "../../src/index.js";
import { Runner } from "./lib/runner.js";
import type { ExerciseContext } from "./lib/types.js";

// Section imports
import { runBundleBuilding } from "./sections/01-bundle-building.js";
import { runFhirflyStorage } from "./sections/02-fhirfly-storage.js";
import { runLocalStorage } from "./sections/03-local-storage.js";
import { runConsumption } from "./sections/04-consumption.js";
import { runAccessControl } from "./sections/05-access-control.js";
import { runEdgeCases } from "./sections/06-edge-cases.js";

const DEFAULT_API_BASE_URL = "https://devapi.fhirfly.io";

const SECTIONS = [
  { num: 1, name: "IPS Bundle Building", fn: runBundleBuilding },
  { num: 2, name: "FhirflyStorage", fn: runFhirflyStorage },
  { num: 3, name: "LocalStorage + Express", fn: runLocalStorage },
  { num: 4, name: "SHL Consumption", fn: runConsumption },
  { num: 5, name: "Access Control & Lifecycle", fn: runAccessControl },
  { num: 6, name: "Edge Cases", fn: runEdgeCases },
];

async function main(): Promise<void> {
  const program = new Command()
    .name("shl-live-exercise")
    .description("FHIRfly SHL SDK — Live Exercise")
    .requiredOption(
      "--api-key <key>",
      "FHIRfly API key (or set FHIRFLY_API_KEY env var)",
      process.env.FHIRFLY_API_KEY,
    )
    .option("--api-base-url <url>", "API base URL", DEFAULT_API_BASE_URL)
    .option("--section <number>", "Run only one section (1-6)")
    .option("--verbose", "Show extra diagnostic output", false)
    .option("--skip-cleanup", "Don't revoke SHLs after exercise", false)
    .parse(process.argv);

  const opts = program.opts<{
    apiKey: string;
    apiBaseUrl: string;
    section?: string;
    verbose: boolean;
    skipCleanup: boolean;
  }>();

  if (!opts.apiKey) {
    console.error("Error: --api-key is required (or set FHIRFLY_API_KEY env var)");
    process.exit(1);
  }

  const sectionFilter = opts.section ? parseInt(opts.section, 10) : undefined;
  if (sectionFilter !== undefined && (sectionFilter < 1 || sectionFilter > 6)) {
    console.error("Error: --section must be between 1 and 6");
    process.exit(1);
  }

  // Initialize terminology client
  const client = new Fhirfly({
    apiKey: opts.apiKey,
    baseUrl: opts.apiBaseUrl,
  });

  const runner = new Runner({ verbose: opts.verbose });
  runner.header(opts.apiBaseUrl);

  const ctx: ExerciseContext = {
    apiKey: opts.apiKey,
    apiBaseUrl: opts.apiBaseUrl,
    client,
    runner,
    verbose: opts.verbose,
    skipCleanup: opts.skipCleanup,
    createdShlIds: [],
  };

  // Run sections
  const sectionsToRun = sectionFilter
    ? SECTIONS.filter((s) => s.num === sectionFilter)
    : SECTIONS;

  for (const section of sectionsToRun) {
    await section.fn(ctx);
  }

  // Cleanup: revoke all created SHLs
  if (!opts.skipCleanup && ctx.createdShlIds.length > 0) {
    runner.section("Cleanup");
    for (const { id, storage } of ctx.createdShlIds) {
      try {
        await SHL.revoke(id, storage);
        runner.info(`Revoked SHL ${id.slice(0, 12)}...`);
      } catch (err) {
        runner.info(
          `Failed to revoke ${id.slice(0, 12)}...: ${err instanceof Error ? err.message : String(err)}`,
          true,
        );
      }
    }
    runner.info(`Cleaned up ${ctx.createdShlIds.length} SHL(s)`, true);
  } else if (opts.skipCleanup && ctx.createdShlIds.length > 0) {
    runner.info(
      `\nSkipped cleanup — ${ctx.createdShlIds.length} SHL(s) left active for manual testing`,
      true,
    );
  }

  // Summary and exit
  const exitCode = runner.summary();
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
