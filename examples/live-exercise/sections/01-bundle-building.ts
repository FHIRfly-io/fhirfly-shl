// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Section 1: IPS Bundle Building
 *
 * Builds a comprehensive IPS Bundle using every add*() variant,
 * validates it, and stores the result in context for later sections.
 */

import { IPS } from "../../../src/index.js";
import { CODE_SYSTEMS } from "../../../src/ips/code-systems.js";
import type { ExerciseContext } from "../lib/types.js";
import {
  PATIENT,
  NDC_PRODUCT,
  RXNORM_METFORMIN,
  SNOMED_LEVOTHYROXINE,
  SNOMED_HYPERTENSION,
  SNOMED_PENICILLIN_ALLERGY,
  ICD10_DIABETES,
  CVX_COVID,
  LOINC_GLUCOSE,
  LOINC_HBA1C,
  EXISTING_MED_STATEMENT,
  EXISTING_CONDITION,
  EXISTING_ALLERGY,
  EXISTING_IMMUNIZATION,
  EXISTING_OBSERVATION,
  SAMPLE_PDF,
} from "../lib/sample-data.js";

export async function runBundleBuilding(ctx: ExerciseContext): Promise<void> {
  const { runner, client, verbose } = ctx;
  runner.section("Section 1: IPS Bundle Building");

  const bundle = new IPS.Bundle(PATIENT);

  // --- Medications ---

  await runner.test("addMedication — byNDC (product)", async () => {
    bundle.addMedication({ byNDC: NDC_PRODUCT, fhirfly: client });
  });

  await runner.test("addMedication — byRxNorm (860975)", async () => {
    bundle.addMedication({
      byRxNorm: RXNORM_METFORMIN,
      fhirfly: client,
      status: "active",
      dosageText: "Take 1 tablet twice daily with meals",
    });
  });

  await runner.test("addMedication — bySNOMED with API (376988009)", async () => {
    bundle.addMedication({ bySNOMED: SNOMED_LEVOTHYROXINE, fhirfly: client });
  });

  await runner.test("addMedication — bySNOMED without API", async () => {
    bundle.addMedication({
      bySNOMED: SNOMED_LEVOTHYROXINE,
      display: "Levothyroxine 75mcg tablet",
    });
  });

  await runner.test("addMedication — fromResource", async () => {
    bundle.addMedication({ fromResource: EXISTING_MED_STATEMENT, fhirfly: client });
  });

  await runner.test("addMedication — manual coding", async () => {
    bundle.addMedication({
      code: "860975",
      system: CODE_SYSTEMS.RXNORM,
      display: "Metformin 500 MG Oral Tablet",
      status: "active",
    });
  });

  // --- Conditions ---

  await runner.test("addCondition — byICD10 (E11.9)", async () => {
    bundle.addCondition({
      byICD10: ICD10_DIABETES,
      fhirfly: client,
      clinicalStatus: "active",
    });
  });

  await runner.test("addCondition — bySNOMED (38341003)", async () => {
    bundle.addCondition({
      bySNOMED: SNOMED_HYPERTENSION,
      fhirfly: client,
      clinicalStatus: "active",
    });
  });

  await runner.test("addCondition — fromResource", async () => {
    bundle.addCondition({ fromResource: EXISTING_CONDITION });
  });

  await runner.test("addCondition — manual coding", async () => {
    bundle.addCondition({
      code: ICD10_DIABETES,
      system: CODE_SYSTEMS.ICD10CM,
      display: "Type 2 diabetes mellitus without complications",
      clinicalStatus: "active",
    });
  });

  // --- Allergies ---

  await runner.test("addAllergy — bySNOMED (91936005)", async () => {
    bundle.addAllergy({
      bySNOMED: SNOMED_PENICILLIN_ALLERGY,
      fhirfly: client,
      clinicalStatus: "active",
      criticality: "high",
    });
  });

  await runner.test("addAllergy — fromResource", async () => {
    bundle.addAllergy({ fromResource: EXISTING_ALLERGY });
  });

  await runner.test("addAllergy — manual coding", async () => {
    bundle.addAllergy({
      code: SNOMED_PENICILLIN_ALLERGY,
      system: CODE_SYSTEMS.SNOMED,
      display: "Allergy to penicillin",
      clinicalStatus: "active",
    });
  });

  // --- Immunizations ---

  await runner.test("addImmunization — byCVX (213)", async () => {
    bundle.addImmunization({
      byCVX: CVX_COVID,
      fhirfly: client,
      status: "completed",
      occurrenceDate: "2024-03-15",
    });
  });

  await runner.test("addImmunization — fromResource", async () => {
    bundle.addImmunization({ fromResource: EXISTING_IMMUNIZATION });
  });

  await runner.test("addImmunization — manual coding", async () => {
    bundle.addImmunization({
      code: CVX_COVID,
      system: CODE_SYSTEMS.CVX,
      display: "SARS-COV-2 (COVID-19) vaccine, UNSPECIFIED",
      status: "completed",
      occurrenceDate: "2024-01-10",
    });
  });

  // --- Results ---

  await runner.test("addResult — byLOINC (2339-0) with value", async () => {
    bundle.addResult({
      byLOINC: LOINC_GLUCOSE,
      fhirfly: client,
      value: 95,
      unit: "mg/dL",
      referenceRange: { low: 70, high: 100, unit: "mg/dL" },
      status: "final",
    });
  });

  await runner.test("addResult — fromResource", async () => {
    bundle.addResult({ fromResource: EXISTING_OBSERVATION });
  });

  await runner.test("addResult — manual with value", async () => {
    bundle.addResult({
      code: LOINC_HBA1C,
      system: CODE_SYSTEMS.LOINC,
      display: "HbA1c/Hemoglobin.total in Blood",
      value: 6.5,
      unit: "%",
      status: "final",
    });
  });

  // --- Documents ---

  await runner.test("addDocument — PDF attachment", async () => {
    bundle.addDocument({
      title: "Lab Report — February 2026",
      content: SAMPLE_PDF,
      contentType: "application/pdf",
    });
  });

  // --- Validation ---

  await runner.test("bundle.validate()", async () => {
    const result = bundle.validate();
    if (!result.valid) {
      const errors = result.issues.filter((i) => i.severity === "error");
      if (errors.length > 0) {
        throw new Error(
          `Validation errors: ${errors.map((e) => e.message).join("; ")}`,
        );
      }
    }
    if (verbose) {
      for (const issue of result.issues) {
        runner.info(`  [${issue.severity}] ${issue.message}`);
      }
    }
  });

  // --- Build ---

  await runner.test("bundle.build()", async () => {
    const fhirBundle = await bundle.build();

    // Verify it's a FHIR Bundle
    if (fhirBundle.resourceType !== "Bundle") {
      throw new Error(`Expected resourceType "Bundle", got "${fhirBundle.resourceType}"`);
    }
    if (fhirBundle.type !== "document") {
      throw new Error(`Expected type "document", got "${fhirBundle.type}"`);
    }

    const entries = fhirBundle.entry as Array<Record<string, unknown>>;
    if (!entries || entries.length < 15) {
      throw new Error(`Expected >= 15 entries, got ${entries?.length ?? 0}`);
    }

    runner.info(`Bundle built: ${entries.length} entries`, true);

    // Store for later sections
    ctx.fhirBundle = fhirBundle;
  });
}
