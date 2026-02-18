// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import type {
  HumanName,
  Address,
  ContactPoint,
  Identifier,
  CodeableConcept,
  Reference,
  AdministrativeGender,
} from "./fhir-types.js";

// ---------------------------------------------------------------------------
// Patient input types
// ---------------------------------------------------------------------------

/**
 * Shorthand patient input for simple cases (90% of use).
 *
 * Use `given` + `family` for structured name, or `name` as a text string.
 *
 * @example
 * ```ts
 * new IPS.Bundle({
 *   given: "Jane",
 *   family: "Doe",
 *   birthDate: "1990-01-15",
 *   gender: "female",
 * });
 * ```
 */
export interface PatientShorthand {
  /** Given (first) name — mutually exclusive with `name` */
  given?: string;
  /** Family (last) name — mutually exclusive with `name` */
  family?: string;
  /** Full name as text (e.g., "Dr. Jane Q. Doe III") — mutually exclusive with given/family */
  name?: string;
  /** Date of birth in YYYY-MM-DD format (required for IPS) */
  birthDate: string;
  /** Administrative gender */
  gender?: AdministrativeGender;
  /** Phone number */
  phone?: string;
  /** Email address */
  email?: string;
  /** Patient identifier — plain string or { system, value } */
  identifier?: string | { system: string; value: string };
}

/**
 * Full FHIR-shaped patient input for complex cases.
 *
 * Arrays for all 0..* fields. Discriminated from shorthand by
 * `Array.isArray(input.name)`.
 *
 * @example
 * ```ts
 * new IPS.Bundle({
 *   name: [{ use: "official", given: ["Jane"], family: "Doe" }],
 *   birthDate: "1990-01-15",
 *   gender: "female",
 * });
 * ```
 */
export interface PatientFull {
  /** Patient name(s) — array of HumanName (discriminant: Array.isArray) */
  name: HumanName[];
  /** Date of birth in YYYY-MM-DD format (required for IPS) */
  birthDate: string;
  /** Administrative gender */
  gender?: AdministrativeGender;
  /** Patient identifier(s) */
  identifier?: Identifier[];
  /** Contact information */
  telecom?: ContactPoint[];
  /** Address(es) */
  address?: Address[];
  /** Whether this patient record is active */
  active?: boolean;
  /** Deceased indicator — boolean or dateTime string */
  deceased?: boolean | string;
  /** Marital status */
  maritalStatus?: CodeableConcept;
  /** General practitioner(s) */
  generalPractitioner?: Reference[];
  /** Communication preferences */
  communication?: PatientCommunication[];
  /** Contact parties (next of kin, emergency contacts) */
  contact?: PatientContact[];
}

/** Patient communication preference. */
export interface PatientCommunication {
  /** Language as a CodeableConcept (e.g., BCP-47 coding) */
  language: CodeableConcept;
  /** Whether this is the preferred language */
  preferred?: boolean;
}

/** Patient contact party (next of kin, emergency contact). */
export interface PatientContact {
  /** Relationship to the patient */
  relationship?: CodeableConcept[];
  /** Contact name */
  name?: HumanName;
  /** Contact information */
  telecom?: ContactPoint[];
  /** Contact address */
  address?: Address;
  /** Administrative gender of the contact */
  gender?: AdministrativeGender;
}

/**
 * Union type for patient input — accepts shorthand or full FHIR-shaped input.
 *
 * Discriminant: `Array.isArray(input.name)` — shorthand has `name?: string`,
 * full has `name: HumanName[]`.
 */
export type PatientDemographics = PatientShorthand | PatientFull;

// ---------------------------------------------------------------------------
// Build & validation types
// ---------------------------------------------------------------------------

/**
 * Options for building an IPS bundle.
 */
export interface BuildOptions {
  /** FHIR profile to validate against */
  profile: "ips" | "r4";
  /** Bundle identifier (auto-generated if not provided) */
  bundleId?: string;
  /** Composition date (defaults to now) */
  compositionDate?: string;
}

/**
 * Result of IPS bundle validation.
 */
export interface ValidationResult {
  /** Whether the bundle is valid */
  valid: boolean;
  /** Validation issues found */
  issues: ValidationIssue[];
}

/**
 * A single validation issue.
 */
export interface ValidationIssue {
  /** Severity of the issue */
  severity: "error" | "warning" | "information";
  /** Human-readable description */
  message: string;
  /** FHIRPath expression to the element */
  path?: string;
}

// ---------------------------------------------------------------------------
// FhirflyClient duck-typed interface
// ---------------------------------------------------------------------------

/**
 * Duck-typed interface for a FHIRfly API client.
 *
 * Any object matching this shape works — including `@fhirfly-io/terminology`
 * or a hand-crafted mock. The SDK does NOT import that package.
 */
export interface FhirflyClient {
  ndc: {
    lookup(code: string, options?: { shape?: string }): Promise<{
      data: {
        ndc: string;
        product_name: string;
        generic_name?: string;
        dosage_form?: string;
        route?: string;
        active_ingredients: Array<{ name: string; strength?: string; unit?: string }>;
        snomed?: Array<{ concept_id: string; display?: string; map_type?: string }>;
      };
    }>;
  };
  rxnorm: {
    lookup(rxcui: string, options?: { shape?: string }): Promise<{
      data: {
        rxcui: string;
        name: string;
        tty: string;
        snomed?: Array<{ concept_id: string; display?: string; map_type?: string }>;
      };
    }>;
  };
  snomed: {
    lookup(conceptId: string): Promise<{
      data: {
        concept_id: string;
        preferred_term: string | null;
        fsn: string | null;
        ips_category: string | null;
      };
    }>;
  };
  icd10: {
    lookup(code: string, options?: { shape?: string }): Promise<{
      data: {
        code: string;
        display: string;
        snomed?: Array<{ concept_id: string; display?: string; map_type?: string }>;
      };
    }>;
  };
  cvx: {
    lookup(cvxCode: string, options?: { shape?: string }): Promise<{
      data: {
        code: string;
        display: string;
        full_vaccine_name: string | null;
      };
    }>;
  };
  loinc: {
    lookup(loincNum: string, options?: { shape?: string }): Promise<{
      data: {
        loinc_num: string;
        component: string;
        long_common_name: string;
        class: string;
        system?: string;
        scale_typ?: string;
        units?: string;
      };
    }>;
  };
}

// ---------------------------------------------------------------------------
// Medication input types (discriminated union)
// ---------------------------------------------------------------------------

/** Medication status values for MedicationStatement */
export type MedicationStatus = "active" | "completed" | "stopped" | "on-hold";

/** Add a medication by NDC code. Requires FHIRfly API for enrichment. */
export interface MedicationByNDC {
  byNDC: string;
  fhirfly: FhirflyClient;
  status?: MedicationStatus;
  dosageText?: string;
  effectiveDate?: string;
  byRxNorm?: never;
  bySNOMED?: never;
  fromResource?: never;
  code?: never;
}

/** Add a medication by RxNorm CUI. Requires FHIRfly API for enrichment. */
export interface MedicationByRxNorm {
  byRxNorm: string;
  fhirfly: FhirflyClient;
  status?: MedicationStatus;
  dosageText?: string;
  effectiveDate?: string;
  byNDC?: never;
  bySNOMED?: never;
  fromResource?: never;
  code?: never;
}

/** Add a medication by SNOMED CT code. API optional (used for preferred_term lookup). */
export interface MedicationBySNOMED {
  bySNOMED: string;
  display?: string;
  fhirfly?: FhirflyClient;
  status?: MedicationStatus;
  dosageText?: string;
  effectiveDate?: string;
  byNDC?: never;
  byRxNorm?: never;
  fromResource?: never;
  code?: never;
}

/** Pass through an existing MedicationStatement or MedicationRequest resource. */
export interface MedicationFromResource {
  fromResource: Record<string, unknown>;
  fhirfly?: FhirflyClient;
  byNDC?: never;
  byRxNorm?: never;
  bySNOMED?: never;
  code?: never;
}

/** Manual medication input with code, system, and display. */
export interface MedicationManual {
  code: string;
  system: string;
  display: string;
  status?: MedicationStatus;
  dosageText?: string;
  effectiveDate?: string;
  byNDC?: never;
  byRxNorm?: never;
  bySNOMED?: never;
  fromResource?: never;
  fhirfly?: never;
}

/** Union of all medication input variants. */
export type MedicationOptions =
  | MedicationByNDC
  | MedicationByRxNorm
  | MedicationBySNOMED
  | MedicationFromResource
  | MedicationManual;

// ---------------------------------------------------------------------------
// Internal resolved medication type
// ---------------------------------------------------------------------------

/** A coding entry for a resolved medication. */
export interface ResolvedCoding {
  system: string;
  code: string;
  display?: string;
}

/** Internal representation of a resolved medication, ready for FHIR generation. */
export interface ResolvedMedication {
  codings: ResolvedCoding[];
  text?: string;
  status: MedicationStatus;
  dosageText?: string;
  effectiveDate?: string;
  /** Original resource for fromResource passthrough */
  originalResource?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Condition input types (discriminated union)
// ---------------------------------------------------------------------------

/** Clinical status values for Condition */
export type ConditionClinicalStatus = "active" | "recurrence" | "relapse" | "inactive" | "remission" | "resolved";

/** Add a condition by ICD-10-CM code. Requires FHIRfly API for enrichment. */
export interface ConditionByICD10 {
  byICD10: string;
  fhirfly: FhirflyClient;
  clinicalStatus?: ConditionClinicalStatus;
  onsetDate?: string;
  bySNOMED?: never;
  fromResource?: never;
  code?: never;
}

/** Add a condition by SNOMED CT code. API optional (used for preferred_term lookup). */
export interface ConditionBySNOMED {
  bySNOMED: string;
  display?: string;
  fhirfly?: FhirflyClient;
  clinicalStatus?: ConditionClinicalStatus;
  onsetDate?: string;
  byICD10?: never;
  fromResource?: never;
  code?: never;
}

/** Pass through an existing Condition resource. */
export interface ConditionFromResource {
  fromResource: Record<string, unknown>;
  fhirfly?: FhirflyClient;
  byICD10?: never;
  bySNOMED?: never;
  code?: never;
}

/** Manual condition input with code, system, and display. */
export interface ConditionManual {
  code: string;
  system: string;
  display: string;
  clinicalStatus?: ConditionClinicalStatus;
  onsetDate?: string;
  byICD10?: never;
  bySNOMED?: never;
  fromResource?: never;
  fhirfly?: never;
}

/** Union of all condition input variants. */
export type ConditionOptions =
  | ConditionByICD10
  | ConditionBySNOMED
  | ConditionFromResource
  | ConditionManual;

/** Internal representation of a resolved condition, ready for FHIR generation. */
export interface ResolvedCondition {
  codings: ResolvedCoding[];
  text?: string;
  clinicalStatus: ConditionClinicalStatus;
  onsetDate?: string;
  originalResource?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Allergy input types (discriminated union)
// ---------------------------------------------------------------------------

/** Clinical status values for AllergyIntolerance */
export type AllergyClinicalStatus = "active" | "inactive" | "resolved";

/** Add an allergy by SNOMED CT code. API optional (used for preferred_term lookup). */
export interface AllergyBySNOMED {
  bySNOMED: string;
  display?: string;
  fhirfly?: FhirflyClient;
  clinicalStatus?: AllergyClinicalStatus;
  criticality?: "low" | "high" | "unable-to-assess";
  fromResource?: never;
  code?: never;
}

/** Pass through an existing AllergyIntolerance resource. */
export interface AllergyFromResource {
  fromResource: Record<string, unknown>;
  fhirfly?: FhirflyClient;
  bySNOMED?: never;
  code?: never;
}

/** Manual allergy input with code, system, and display. */
export interface AllergyManual {
  code: string;
  system: string;
  display: string;
  clinicalStatus?: AllergyClinicalStatus;
  criticality?: "low" | "high" | "unable-to-assess";
  bySNOMED?: never;
  fromResource?: never;
  fhirfly?: never;
}

/** Union of all allergy input variants. */
export type AllergyOptions =
  | AllergyBySNOMED
  | AllergyFromResource
  | AllergyManual;

/** Internal representation of a resolved allergy, ready for FHIR generation. */
export interface ResolvedAllergy {
  codings: ResolvedCoding[];
  text?: string;
  clinicalStatus: AllergyClinicalStatus;
  criticality?: "low" | "high" | "unable-to-assess";
  originalResource?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Immunization input types (discriminated union)
// ---------------------------------------------------------------------------

/** Add an immunization by CVX code. Requires FHIRfly API for enrichment. */
export interface ImmunizationByCVX {
  byCVX: string;
  fhirfly: FhirflyClient;
  status?: "completed" | "not-done";
  occurrenceDate?: string;
  fromResource?: never;
  code?: never;
}

/** Pass through an existing Immunization resource. */
export interface ImmunizationFromResource {
  fromResource: Record<string, unknown>;
  fhirfly?: FhirflyClient;
  byCVX?: never;
  code?: never;
}

/** Manual immunization input with code, system, and display. */
export interface ImmunizationManual {
  code: string;
  system: string;
  display: string;
  status?: "completed" | "not-done";
  occurrenceDate?: string;
  byCVX?: never;
  fromResource?: never;
  fhirfly?: never;
}

/** Union of all immunization input variants. */
export type ImmunizationOptions =
  | ImmunizationByCVX
  | ImmunizationFromResource
  | ImmunizationManual;

/** Internal representation of a resolved immunization, ready for FHIR generation. */
export interface ResolvedImmunization {
  codings: ResolvedCoding[];
  text?: string;
  status: "completed" | "not-done";
  occurrenceDate?: string;
  originalResource?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Result input types (discriminated union)
// ---------------------------------------------------------------------------

/** Observation status values */
export type ObservationStatus = "registered" | "preliminary" | "final" | "amended" | "corrected" | "cancelled" | "entered-in-error" | "unknown";

/** Common result fields shared across all result input variants. */
interface ResultCommon {
  /** Numeric result value */
  value?: number;
  /** Unit of measurement (e.g., "mg/dL", "mmol/L") */
  unit?: string;
  /** UCUM unit code (e.g., "mg/dL") — defaults to `unit` if not provided */
  unitCode?: string;
  /** Reference range for interpretation */
  referenceRange?: { low?: number; high?: number; unit?: string };
  /** When the observation was made (YYYY-MM-DD) */
  effectiveDate?: string;
  /** Observation status */
  status?: ObservationStatus;
  /** String result value (for non-numeric results like "Positive", "Negative") */
  valueString?: string;
}

/** Add a result by LOINC code. Requires FHIRfly API for enrichment. */
export interface ResultByLOINC extends ResultCommon {
  byLOINC: string;
  fhirfly: FhirflyClient;
  fromResource?: never;
  code?: never;
}

/** Pass through an existing Observation resource. */
export interface ResultFromResource {
  fromResource: Record<string, unknown>;
  fhirfly?: FhirflyClient;
  byLOINC?: never;
  code?: never;
}

/** Manual result input with code, system, and display. */
export interface ResultManual extends ResultCommon {
  code: string;
  system: string;
  display: string;
  byLOINC?: never;
  fromResource?: never;
  fhirfly?: never;
}

/** Union of all result input variants. */
export type ResultOptions =
  | ResultByLOINC
  | ResultFromResource
  | ResultManual;

/** Internal representation of a resolved result, ready for FHIR generation. */
export interface ResolvedResult {
  codings: ResolvedCoding[];
  text?: string;
  status: ObservationStatus;
  value?: number;
  valueString?: string;
  unit?: string;
  unitCode?: string;
  referenceRange?: { low?: number; high?: number; unit?: string };
  effectiveDate?: string;
  originalResource?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Document input types
// ---------------------------------------------------------------------------

/** Options for adding a document (PDF, TIFF, JPG, etc.) to the IPS bundle. */
export interface DocumentOptions {
  /** Document title (e.g., "Lab Report", "Discharge Summary") */
  title: string;
  /** Document content as binary data */
  content: Buffer | Uint8Array;
  /** MIME content type (defaults to "application/pdf") */
  contentType?: string;
  /** Document date (YYYY-MM-DD, defaults to today) */
  date?: string;
  /** LOINC document type code (defaults to "34133-9" Summarization of episode note) */
  typeCode?: string;
  /** Display name for the LOINC type code */
  typeDisplay?: string;
}
