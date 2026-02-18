// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Sample clinical data for the live exercise.
 *
 * All codes verified against https://devapi.fhirfly.io on 2026-02-18.
 */

import { CODE_SYSTEMS } from "../../../src/ips/code-systems.js";

// ---------------------------------------------------------------------------
// Patient
// ---------------------------------------------------------------------------

export const PATIENT = {
  given: "Maria",
  family: "Garcia",
  birthDate: "1985-07-22",
  gender: "female" as const,
};

// ---------------------------------------------------------------------------
// NDC codes
// ---------------------------------------------------------------------------

/** Atorvastatin calcium 40mg tablet — Preferred Pharmaceuticals (product NDC) */
export const NDC_PRODUCT = "68788-8298";

/** Dabigatran Etexilate capsule — Camber Pharmaceuticals (package NDC) */
export const NDC_PACKAGE = "31722062160";

/** Invalid NDC for graceful degradation test */
export const NDC_INVALID = "9999-9999-99";

// ---------------------------------------------------------------------------
// RxNorm
// ---------------------------------------------------------------------------

/** 24 HR metformin hydrochloride 500 MG Extended Release Oral Tablet */
export const RXNORM_METFORMIN = "860975";

// ---------------------------------------------------------------------------
// SNOMED CT
// ---------------------------------------------------------------------------

/** Levothyroxine sodium 75 microgram oral tablet (clinical drug) */
export const SNOMED_LEVOTHYROXINE = "376988009";

/** Hypertensive disorder (disorder) */
export const SNOMED_HYPERTENSION = "38341003";

/** Allergy to penicillin (finding) */
export const SNOMED_PENICILLIN_ALLERGY = "91936005";

/** Aspirin allergy (finding) */
export const SNOMED_ASPIRIN_ALLERGY = "293586001";

// ---------------------------------------------------------------------------
// ICD-10-CM
// ---------------------------------------------------------------------------

/** Type 2 diabetes mellitus without complications */
export const ICD10_DIABETES = "E11.9";

/** Invalid ICD-10 for graceful degradation test */
export const ICD10_INVALID = "Z99.99";

// ---------------------------------------------------------------------------
// CVX
// ---------------------------------------------------------------------------

/** SARS-COV-2 (COVID-19) vaccine, UNSPECIFIED (inactive) */
export const CVX_COVID = "213";

/** Influenza, seasonal, injectable, preservative free (active) */
export const CVX_FLU = "141";

// ---------------------------------------------------------------------------
// LOINC
// ---------------------------------------------------------------------------

/** Glucose [Mass/volume] in Blood */
export const LOINC_GLUCOSE = "2339-0";

/** Hemoglobin A1c/Hemoglobin.total in Blood */
export const LOINC_HBA1C = "4548-4";

/** Creatinine [Mass/volume] in Serum or Plasma */
export const LOINC_CREATININE = "2160-0";

// ---------------------------------------------------------------------------
// Pre-built FHIR resources for fromResource tests
// ---------------------------------------------------------------------------

/** Existing MedicationStatement resource (Metformin) */
export const EXISTING_MED_STATEMENT: Record<string, unknown> = {
  resourceType: "MedicationStatement",
  status: "active",
  medicationCodeableConcept: {
    coding: [
      {
        system: CODE_SYSTEMS.RXNORM,
        code: RXNORM_METFORMIN,
        display: "Metformin 500 MG Extended Release Oral Tablet",
      },
    ],
    text: "Metformin 500 MG",
  },
  dosage: [
    {
      text: "Take 1 tablet by mouth twice daily with meals",
    },
  ],
};

/** Existing Condition resource (Hypertension) */
export const EXISTING_CONDITION: Record<string, unknown> = {
  resourceType: "Condition",
  clinicalStatus: {
    coding: [
      {
        system: CODE_SYSTEMS.CONDITION_CLINICAL,
        code: "active",
      },
    ],
  },
  code: {
    coding: [
      {
        system: CODE_SYSTEMS.SNOMED,
        code: SNOMED_HYPERTENSION,
        display: "Hypertensive disorder",
      },
    ],
    text: "Hypertension",
  },
  onsetDateTime: "2020-06-15",
};

/** Existing AllergyIntolerance resource (Aspirin allergy) */
export const EXISTING_ALLERGY: Record<string, unknown> = {
  resourceType: "AllergyIntolerance",
  clinicalStatus: {
    coding: [
      {
        system: CODE_SYSTEMS.ALLERGY_CLINICAL,
        code: "active",
      },
    ],
  },
  code: {
    coding: [
      {
        system: CODE_SYSTEMS.SNOMED,
        code: SNOMED_ASPIRIN_ALLERGY,
        display: "Aspirin allergy",
      },
    ],
    text: "Aspirin allergy",
  },
  criticality: "high",
};

/** Existing Immunization resource (Influenza) */
export const EXISTING_IMMUNIZATION: Record<string, unknown> = {
  resourceType: "Immunization",
  status: "completed",
  vaccineCode: {
    coding: [
      {
        system: CODE_SYSTEMS.CVX,
        code: CVX_FLU,
        display: "Influenza, seasonal, injectable, preservative free",
      },
    ],
  },
  occurrenceDateTime: "2025-10-01",
};

/** Existing Observation resource (Creatinine) */
export const EXISTING_OBSERVATION: Record<string, unknown> = {
  resourceType: "Observation",
  status: "final",
  code: {
    coding: [
      {
        system: CODE_SYSTEMS.LOINC,
        code: LOINC_CREATININE,
        display: "Creatinine [Mass/volume] in Serum or Plasma",
      },
    ],
  },
  valueQuantity: {
    value: 0.9,
    unit: "mg/dL",
    system: "http://unitsofmeasure.org",
    code: "mg/dL",
  },
  referenceRange: [
    {
      low: { value: 0.6, unit: "mg/dL" },
      high: { value: 1.2, unit: "mg/dL" },
    },
  ],
};

// ---------------------------------------------------------------------------
// Sample PDF (minimal valid PDF for addDocument)
// ---------------------------------------------------------------------------

/**
 * Minimal valid PDF file (one blank page).
 * Just enough to pass content-type detection without bloating the exercise.
 */
export const SAMPLE_PDF = Buffer.from(
  "%PDF-1.0\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj " +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj " +
    "3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R>>endobj\n" +
    "xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n" +
    "0000000058 00000 n \n0000000115 00000 n \n" +
    "trailer<</Size 4/Root 1 0 R>>\nstartxref\n190\n%%EOF",
);
