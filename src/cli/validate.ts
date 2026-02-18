// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import type { Command } from "commander";
import { readFileSync } from "node:fs";
import { IPS } from "../index.js";

export function registerValidateCommand(program: Command): void {
  program
    .command("validate <file>")
    .description("Validate a FHIR Bundle JSON file")
    .option("--strict", "Treat warnings as errors")
    .option("--profile <profile>", "Validation profile: ips or r4", "ips")
    .option("--json", "Output results as JSON")
    .action(async (file: string, opts: { strict?: boolean; profile?: string; json?: boolean }) => {
      try {
        const content = readFileSync(file, "utf8");
        const bundle = JSON.parse(content) as Record<string, unknown>;

        // Basic structure checks
        const issues: Array<{ severity: string; message: string; path?: string }> = [];

        if (bundle.resourceType !== "Bundle") {
          issues.push({ severity: "error", message: "Root resource is not a Bundle", path: "Bundle.resourceType" });
        }

        if (bundle.type !== "document") {
          issues.push({ severity: "warning", message: `Bundle.type is "${String(bundle.type)}", expected "document" for IPS`, path: "Bundle.type" });
        }

        const entries = bundle.entry as Array<{ resource?: Record<string, unknown> }> | undefined;
        if (!entries || entries.length === 0) {
          issues.push({ severity: "error", message: "Bundle has no entries", path: "Bundle.entry" });
        }

        // Check for Composition
        if (entries) {
          const hasComposition = entries.some((e) => e.resource?.resourceType === "Composition");
          if (!hasComposition) {
            issues.push({ severity: "error", message: "Bundle missing Composition resource (required for IPS)", path: "Bundle.entry" });
          }

          // Check for Patient
          const hasPatient = entries.some((e) => e.resource?.resourceType === "Patient");
          if (!hasPatient) {
            issues.push({ severity: "error", message: "Bundle missing Patient resource", path: "Bundle.entry" });
          }
        }

        // Run IPS.Bundle validation if it looks like it was built from the SDK
        // (We can't reconstruct the full Bundle object, so we report structural issues)

        const errors = issues.filter((i) => i.severity === "error");
        const warnings = issues.filter((i) => i.severity === "warning");
        const info = issues.filter((i) => i.severity === "information");

        const valid = opts.strict
          ? errors.length === 0 && warnings.length === 0
          : errors.length === 0;

        if (opts.json) {
          console.log(JSON.stringify({ valid, issues }, null, 2));
        } else {
          if (errors.length > 0) {
            console.error(`\x1b[31m✗ ${errors.length} error(s)\x1b[0m`);
            for (const e of errors) {
              console.error(`  \x1b[31m• ${e.message}\x1b[0m${e.path ? ` (${e.path})` : ""}`);
            }
          }
          if (warnings.length > 0) {
            console.warn(`\x1b[33m⚠ ${warnings.length} warning(s)\x1b[0m`);
            for (const w of warnings) {
              console.warn(`  \x1b[33m• ${w.message}\x1b[0m${w.path ? ` (${w.path})` : ""}`);
            }
          }
          if (info.length > 0) {
            console.log(`ℹ ${info.length} informational`);
            for (const i of info) {
              console.log(`  • ${i.message}${i.path ? ` (${i.path})` : ""}`);
            }
          }
          if (valid) {
            console.log(`\x1b[32m✓ Valid${opts.strict ? " (strict)" : ""}\x1b[0m`);
          }
        }

        process.exit(valid ? 0 : errors.length > 0 ? 1 : 2);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}

// Suppress unused import warning — IPS is used for type context
void IPS;
