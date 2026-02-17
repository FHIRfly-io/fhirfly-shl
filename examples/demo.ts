/**
 * FHIRfly SHL SDK — End-to-end demo
 *
 * Creates an IPS bundle for a sample patient and shares it via a SMART Health Link.
 *
 * Usage:
 *   npx tsx examples/demo.ts                          # Local storage (default)
 *   npx tsx examples/demo.ts --s3 --bucket <name> \   # S3 storage
 *     --region <region> --base-url <url>
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { IPS, SHL } from "../src/index.js";

// ---------------------------------------------------------------------------
// CLI argument parsing (no deps)
// ---------------------------------------------------------------------------

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1 || idx + 1 >= process.argv.length) return undefined;
  return process.argv[idx + 1];
}

const useS3 = process.argv.includes("--s3");
const bucket = getArg("bucket");
const region = getArg("region") ?? "us-east-1";
const baseUrl = getArg("base-url");
const outputDir = "./shl-output";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("=== FHIRfly SHL SDK Demo ===\n");

  // 1. Create IPS Bundle for sample patient
  const bundle = new IPS.Bundle({
    given: "Maria",
    family: "Garcia",
    birthDate: "1985-07-22",
    gender: "female",
  });

  // 2. Add clinical data (manual inputs — no API calls needed)
  bundle.addMedication({
    code: "860975",
    system: "http://www.nlm.nih.gov/research/umls/rxnorm",
    display: "Metformin 500 MG Oral Tablet",
    status: "active",
    effectiveDate: "2024-01-15",
    dosageText: "Take 1 tablet by mouth twice daily with meals",
  });

  bundle.addCondition({
    code: "E11.9",
    system: "http://hl7.org/fhir/sid/icd-10-cm",
    display: "Type 2 diabetes mellitus without complications",
    clinicalStatus: "active",
  });

  bundle.addAllergy({
    code: "91936005",
    system: "http://snomed.info/sct",
    display: "Allergy to penicillin",
    clinicalStatus: "active",
    criticality: "high",
  });

  bundle.addImmunization({
    code: "213",
    system: "http://hl7.org/fhir/sid/cvx",
    display: "SARS-COV-2 (COVID-19) vaccine, UNSPECIFIED",
    status: "completed",
    occurrenceDate: "2024-03-15",
  });

  // 3. Build the FHIR Bundle
  const fhirBundle = await bundle.build();
  console.log(
    `Bundle built: ${(fhirBundle.entry as unknown[]).length} entries\n`,
  );

  // 4. Select storage backend
  let storage: SHL.LocalStorage | SHL.S3Storage;

  if (useS3) {
    if (!bucket) {
      console.error("Error: --bucket is required when using --s3");
      process.exit(1);
    }
    if (!baseUrl) {
      console.error("Error: --base-url is required when using --s3");
      process.exit(1);
    }
    storage = new SHL.S3Storage({ bucket, region, baseUrl });
    console.log(`Storage: S3 (bucket=${bucket}, region=${region})`);
  } else {
    storage = new SHL.LocalStorage({
      directory: outputDir,
      baseUrl: "http://localhost:3000/shl",
    });
    console.log(`Storage: Local (${outputDir})`);
  }

  // 5. Create SMART Health Link
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  const result = await SHL.create({
    bundle: fhirBundle,
    storage,
    passcode: "1234",
    label: "Maria Garcia \u2014 Patient Summary",
    expiresAt,
  });

  // 6. Save QR code as PNG
  const qrOutputDir = useS3 ? outputDir : join(outputDir, result.id);
  mkdirSync(qrOutputDir, { recursive: true });
  const qrPath = join(qrOutputDir, "qrcode.png");

  // Decode data URI (data:image/png;base64,...) → Buffer → file
  const base64Data = result.qrCode.split(",")[1];
  if (base64Data) {
    writeFileSync(qrPath, Buffer.from(base64Data, "base64"));
  }

  // 7. Print results
  console.log("\n--- SMART Health Link Created ---");
  console.log(`  SHL ID:    ${result.id}`);
  console.log(`  URL:       ${result.url.slice(0, 60)}...`);
  console.log(`  Passcode:  ${result.passcode}`);
  console.log(`  Expires:   ${result.expiresAt?.toISOString()}`);
  console.log(`  QR Code:   ${qrPath}`);

  if (!useS3) {
    console.log(`\n  Files written to ${outputDir}/${result.id}/`);
    console.log("    - content.jwe");
    console.log("    - manifest.json");
    console.log("    - metadata.json");
    console.log("    - qrcode.png");
  }

  console.log("\nDone!");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
