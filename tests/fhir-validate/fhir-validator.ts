/**
 * Test helper: invokes the HL7 FHIR Validator CLI from TypeScript.
 *
 * Usage:
 *   import { isValidatorAvailable, validateBundles } from "./fhir-validator.js";
 *
 *   describe.skipIf(!isValidatorAvailable())("FHIR Validation", () => { ... });
 */

import { execFile, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const PROJECT_ROOT = resolve(import.meta.dirname, "../..");
const VALIDATOR_DIR = join(PROJECT_ROOT, ".validator");
const JAR_PATH = join(VALIDATOR_DIR, "validator_cli.jar");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single issue from the FHIR OperationOutcome. */
export interface FhirValidationIssue {
  severity: "fatal" | "error" | "warning" | "information";
  diagnostics: string;
  location?: string[];
}

/** Validation result for a single bundle. */
export interface FhirValidationResult {
  valid: boolean;
  errors: FhirValidationIssue[];
  warnings: FhirValidationIssue[];
  informational: FhirValidationIssue[];
  raw: Record<string, unknown> | null;
  stdout: string;
  stderr: string;
}

// ---------------------------------------------------------------------------
// Availability check
// ---------------------------------------------------------------------------

let _available: boolean | null = null;

/** Check whether the FHIR validator jar and Java are present. */
export function isValidatorAvailable(): boolean {
  if (_available !== null) return _available;

  if (!existsSync(JAR_PATH)) {
    _available = false;
    return false;
  }

  // Check java
  try {
    execFileSync("java", ["-version"], { stdio: "pipe" });
    _available = true;
  } catch {
    _available = false;
  }

  return _available;
}

// ---------------------------------------------------------------------------
// Single bundle validation
// ---------------------------------------------------------------------------

/**
 * Validate a single FHIR bundle against the specified profile.
 *
 * @param bundle  The FHIR Bundle as a JS object
 * @param options.profile  "ips" for IPS profile validation, "r4" for base R4 only
 */
export async function validateBundle(
  bundle: Record<string, unknown>,
  options?: { profile?: "ips" | "r4" },
): Promise<FhirValidationResult> {
  const results = await validateBundles([{ name: "bundle", bundle }], options);
  return results.get("bundle")!;
}

// ---------------------------------------------------------------------------
// Batch bundle validation
// ---------------------------------------------------------------------------

/**
 * Validate multiple FHIR bundles in a single JVM invocation.
 *
 * Pays the JVM startup + IG loading cost once, then validates all files.
 *
 * @param bundles  Array of { name, bundle } — name is used as the key in the result map
 * @param options.profile  "ips" for IPS profile validation, "r4" for base R4 only
 * @returns Map from bundle name to validation result
 */
export async function validateBundles(
  bundles: Array<{ name: string; bundle: Record<string, unknown> }>,
  options?: { profile?: "ips" | "r4" },
): Promise<Map<string, FhirValidationResult>> {
  const profile = options?.profile ?? "ips";
  const tmpDir = join(VALIDATOR_DIR, "tmp", randomUUID());
  mkdirSync(tmpDir, { recursive: true });

  const results = new Map<string, FhirValidationResult>();

  try {
    // Write all bundles to individual files
    const fileMap = new Map<string, string>(); // filePath → name
    for (const { name, bundle } of bundles) {
      const filePath = join(tmpDir, `${name}.json`);
      writeFileSync(filePath, JSON.stringify(bundle, null, 2));
      fileMap.set(filePath, name);
    }

    // Validate each file individually (the validator only generates one
    // OperationOutcome per -output invocation when given multiple source
    // files, making it impossible to attribute errors to specific bundles).
    for (const [filePath, name] of fileMap) {
      const outputPath = join(tmpDir, `${name}-result.json`);

      const args = [
        "-jar", JAR_PATH,
        filePath,
        "-version", "4.0",
        "-output", outputPath,
      ];

      if (profile === "ips") {
        args.push("-ig", "hl7.fhir.uv.ips");
      }

      const { stdout, stderr } = await runValidator(args);
      const result = parseOutput(outputPath, stdout, stderr);
      results.set(name, result);
    }
  } finally {
    // Clean up temp files
    rmSync(tmpDir, { recursive: true, force: true });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Internal: run the validator
// ---------------------------------------------------------------------------

function runValidator(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      "java",
      args,
      {
        maxBuffer: 50 * 1024 * 1024, // 50MB — validator can be verbose
        timeout: 5 * 60 * 1000,       // 5 minutes per invocation
      },
      (error, stdout, stderr) => {
        // The validator exits with non-zero when there are validation errors,
        // but it still writes the output file. We don't treat this as a failure.
        resolve({
          stdout: (error && !stdout) ? (error.message ?? "") : (stdout ?? ""),
          stderr: stderr ?? "",
        });
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Internal: parse OperationOutcome JSON
// ---------------------------------------------------------------------------

function parseOutput(
  outputPath: string,
  stdout: string,
  stderr: string,
): FhirValidationResult {
  let raw: Record<string, unknown> | null = null;
  const errors: FhirValidationIssue[] = [];
  const warnings: FhirValidationIssue[] = [];
  const informational: FhirValidationIssue[] = [];

  if (existsSync(outputPath)) {
    try {
      const content = readFileSync(outputPath, "utf-8");
      raw = JSON.parse(content) as Record<string, unknown>;
      const issues = (raw.issue ?? []) as Array<Record<string, unknown>>;

      for (const issue of issues) {
        const severity = issue.severity as string;
        const diagnostics = (issue.diagnostics as string) ?? (issue.details as { text?: string })?.text ?? "";
        const location = issue.location as string[] | undefined;
        const expression = issue.expression as string[] | undefined;

        const parsed: FhirValidationIssue = {
          severity: severity as FhirValidationIssue["severity"],
          diagnostics,
          location: expression ?? location,
        };

        if (severity === "error" || severity === "fatal") {
          errors.push(parsed);
        } else if (severity === "warning") {
          warnings.push(parsed);
        } else {
          informational.push(parsed);
        }
      }
    } catch {
      // If we can't parse the output, treat as an error
      errors.push({
        severity: "fatal",
        diagnostics: `Failed to parse validator output: ${outputPath}`,
      });
    }
  } else {
    // No output file — likely a JVM error
    errors.push({
      severity: "fatal",
      diagnostics: `Validator did not produce output. stderr: ${stderr.slice(0, 500)}`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    informational,
    raw,
    stdout,
    stderr,
  };
}
