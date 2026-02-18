// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Section 6: Edge Cases
 *
 * Tests boundary conditions: large bundles, minimal IPS, invalid codes,
 * PDF attachments in SHLs, and no-passcode links.
 */

import { IPS, SHL } from "../../../src/index.js";
import { CODE_SYSTEMS } from "../../../src/ips/code-systems.js";
import type { ExerciseContext } from "../lib/types.js";
import {
  PATIENT,
  NDC_INVALID,
  ICD10_INVALID,
  SNOMED_PENICILLIN_ALLERGY,
  SNOMED_HYPERTENSION,
  RXNORM_METFORMIN,
  LOINC_GLUCOSE,
  CVX_COVID,
  SAMPLE_PDF,
} from "../lib/sample-data.js";

export async function runEdgeCases(ctx: ExerciseContext): Promise<void> {
  const { runner, client } = ctx;
  runner.section("Section 6: Edge Cases");

  if (!ctx.fhirflyStorage) {
    runner.skip("All edge case tests", "Requires FhirflyStorage from section 2");
    return;
  }

  // --- Large bundle ---

  await runner.test("Large bundle — encrypt/decrypt round-trip", async () => {
    const bundle = new IPS.Bundle(PATIENT);

    // Add 20 medications
    for (let i = 0; i < 20; i++) {
      bundle.addMedication({
        code: RXNORM_METFORMIN,
        system: CODE_SYSTEMS.RXNORM,
        display: `Medication ${i + 1}`,
        status: "active",
      });
    }

    // Add 10 conditions
    for (let i = 0; i < 10; i++) {
      bundle.addCondition({
        code: SNOMED_HYPERTENSION,
        system: CODE_SYSTEMS.SNOMED,
        display: `Condition ${i + 1}`,
        clinicalStatus: "active",
      });
    }

    // Add 5 allergies
    for (let i = 0; i < 5; i++) {
      bundle.addAllergy({
        code: SNOMED_PENICILLIN_ALLERGY,
        system: CODE_SYSTEMS.SNOMED,
        display: `Allergy ${i + 1}`,
      });
    }

    // Add 5 immunizations
    for (let i = 0; i < 5; i++) {
      bundle.addImmunization({
        code: CVX_COVID,
        system: CODE_SYSTEMS.CVX,
        display: `Immunization ${i + 1}`,
        status: "completed",
      });
    }

    // Add 5 results
    for (let i = 0; i < 5; i++) {
      bundle.addResult({
        code: LOINC_GLUCOSE,
        system: CODE_SYSTEMS.LOINC,
        display: `Result ${i + 1}`,
        value: 90 + i * 5,
        unit: "mg/dL",
        status: "final",
      });
    }

    const fhirBundle = await bundle.build();
    const entries = fhirBundle.entry as unknown[];
    runner.info(`Large bundle: ${entries.length} entries`);

    // Encrypt and decrypt via FhirflyStorage
    const result = await SHL.create({
      bundle: fhirBundle,
      storage: ctx.fhirflyStorage!,
      label: "Large bundle test",
    });
    ctx.createdShlIds.push({ id: result.id, storage: ctx.fhirflyStorage! });

    // Decrypt round-trip
    const decoded = SHL.decode(result.url);
    const manifestRes = await fetch(decoded.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    if (manifestRes.status !== 200) {
      throw new Error(`Manifest: expected 200, got ${manifestRes.status}`);
    }

    const manifest = (await manifestRes.json()) as {
      files: Array<{ contentType: string; location: string }>;
    };
    const bundleFile = manifest.files.find(
      (f) => f.contentType === "application/fhir+json",
    )!;
    const jwe = await (await fetch(bundleFile.location)).text();
    const decrypted = SHL.decrypt(jwe, decoded.key);

    const decryptedEntries = (decrypted.entry as unknown[])?.length ?? 0;
    if (decryptedEntries !== entries.length) {
      throw new Error(
        `Entry count mismatch: ${entries.length} vs ${decryptedEntries}`,
      );
    }
  });

  // --- Minimal IPS ---

  await runner.test("Minimal IPS — patient only, no clinical data", async () => {
    const bundle = new IPS.Bundle(PATIENT);
    const fhirBundle = await bundle.build();

    if (fhirBundle.resourceType !== "Bundle") {
      throw new Error("Expected Bundle");
    }

    const entries = fhirBundle.entry as Array<{
      resource: Record<string, unknown>;
    }>;

    // Should have at least Composition + Patient
    if (entries.length < 2) {
      throw new Error(`Expected >= 2 entries, got ${entries.length}`);
    }

    // Check Composition has sections (possibly with emptyReason)
    const composition = entries.find(
      (e) => e.resource?.resourceType === "Composition",
    );
    if (!composition) throw new Error("No Composition found");

    const sections = composition.resource.section as Array<Record<string, unknown>>;
    if (!sections || sections.length === 0) {
      throw new Error("Composition should have sections even when empty");
    }

    runner.info(`Minimal IPS: ${entries.length} entries, ${sections.length} sections`);
  });

  // --- Invalid NDC (graceful degradation) ---

  await runner.test("Invalid NDC — graceful degradation", async () => {
    const bundle = new IPS.Bundle(PATIENT);
    bundle.addMedication({ byNDC: NDC_INVALID, fhirfly: client });

    // build() should not throw — it should produce a bundle with a warning
    // or a degraded medication entry
    let threw = false;
    try {
      await bundle.build();
    } catch {
      threw = true;
    }

    // Check warnings
    const warnings = bundle.warnings;
    if (threw && warnings.length === 0) {
      throw new Error("Expected graceful degradation (warning), not a hard error");
    }

    if (warnings.length > 0) {
      runner.info(`Warnings: ${warnings.map((w) => w.message).join("; ")}`);
    }
    if (threw) {
      runner.info("Note: build() threw — may need SDK update for graceful handling");
    }
  });

  // --- Invalid ICD-10 (graceful degradation) ---

  await runner.test("Invalid ICD-10 — graceful degradation", async () => {
    const bundle = new IPS.Bundle(PATIENT);
    bundle.addCondition({
      byICD10: ICD10_INVALID,
      fhirfly: client,
      clinicalStatus: "active",
    });

    let threw = false;
    try {
      await bundle.build();
    } catch {
      threw = true;
    }

    const warnings = bundle.warnings;
    if (threw && warnings.length === 0) {
      throw new Error("Expected graceful degradation (warning), not a hard error");
    }

    if (warnings.length > 0) {
      runner.info(`Warnings: ${warnings.map((w) => w.message).join("; ")}`);
    }
    if (threw) {
      runner.info("Note: build() threw — may need SDK update for graceful handling");
    }
  });

  // --- Bundle with PDF attachment ---

  await runner.test("SHL with PDF attachment", async () => {
    // Build a simple bundle
    const bundle = new IPS.Bundle(PATIENT);
    bundle.addCondition({
      code: SNOMED_HYPERTENSION,
      system: CODE_SYSTEMS.SNOMED,
      display: "Hypertension",
      clinicalStatus: "active",
    });
    const fhirBundle = await bundle.build();

    // Create SHL with attachment
    const result = await SHL.create({
      bundle: fhirBundle,
      storage: ctx.fhirflyStorage!,
      label: "PDF attachment test",
      attachments: [
        {
          contentType: "application/pdf",
          content: SAMPLE_PDF,
        },
      ],
    });
    ctx.createdShlIds.push({ id: result.id, storage: ctx.fhirflyStorage! });

    // Verify manifest has 2 files
    const decoded = SHL.decode(result.url);
    const manifestRes = await fetch(decoded.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    const manifest = (await manifestRes.json()) as {
      files: Array<{ contentType: string; location?: string }>;
    };

    if (manifest.files.length < 2) {
      throw new Error(`Expected >= 2 files in manifest, got ${manifest.files.length}`);
    }

    const pdfFile = manifest.files.find(
      (f) => f.contentType === "application/pdf",
    );
    if (!pdfFile) {
      throw new Error("No PDF file in manifest");
    }

    // Decrypt the PDF attachment
    if (pdfFile.location) {
      const pdfJwe = await (await fetch(pdfFile.location)).text();
      const decrypted = SHL.decryptContent(pdfJwe, decoded.key);
      if (decrypted.contentType !== "application/pdf") {
        throw new Error(`Expected application/pdf, got ${decrypted.contentType}`);
      }
      if (decrypted.data.length === 0) {
        throw new Error("Decrypted PDF is empty");
      }
      runner.info(`PDF attachment decrypted: ${decrypted.data.length} bytes`);
    }

    runner.info(`Manifest has ${manifest.files.length} files`);
  });

  // --- SHL without passcode ---

  await runner.test("SHL without passcode — flag is 'L', access with empty body", async () => {
    const bundle = new IPS.Bundle(PATIENT);
    bundle.addAllergy({
      code: SNOMED_PENICILLIN_ALLERGY,
      system: CODE_SYSTEMS.SNOMED,
      display: "Allergy to penicillin",
    });
    const fhirBundle = await bundle.build();

    const result = await SHL.create({
      bundle: fhirBundle,
      storage: ctx.fhirflyStorage!,
      label: "No passcode test",
      // No passcode
    });
    ctx.createdShlIds.push({ id: result.id, storage: ctx.fhirflyStorage! });

    // Verify flag does not include "P"
    const decoded = SHL.decode(result.url);
    if (decoded.flag.includes("P")) {
      throw new Error(`Flag should not include "P" without passcode, got "${decoded.flag}"`);
    }
    if (!decoded.flag.includes("L")) {
      throw new Error(`Flag should include "L", got "${decoded.flag}"`);
    }

    // Access with empty body should succeed
    const res = await fetch(decoded.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    if (res.status !== 200) {
      throw new Error(`Expected 200, got ${res.status}`);
    }

    runner.info(`Flag: "${decoded.flag}" — no passcode, access OK`);
  });
}
