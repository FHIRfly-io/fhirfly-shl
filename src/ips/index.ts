// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
export { Bundle } from "./bundle.js";

// Code system constants
export { CODE_SYSTEMS } from "./code-systems.js";

// Patient input types
export type {
  PatientDemographics,
  PatientShorthand,
  PatientFull,
  PatientCommunication,
  PatientContact,
} from "./types.js";

// Build & validation types
export type {
  BuildOptions,
  ValidationResult,
  ValidationIssue,
} from "./types.js";

// Clinical entry option types
export type {
  MedicationOptions,
  MedicationByNDC,
  MedicationByRxNorm,
  MedicationBySNOMED,
  MedicationFromResource,
  MedicationManual,
  MedicationStatus,
  FhirflyClient,
  ConditionOptions,
  ConditionByICD10,
  ConditionBySNOMED,
  ConditionFromResource,
  ConditionManual,
  ConditionClinicalStatus,
  AllergyOptions,
  AllergyBySNOMED,
  AllergyFromResource,
  AllergyManual,
  AllergyClinicalStatus,
  ImmunizationOptions,
  ImmunizationByCVX,
  ImmunizationFromResource,
  ImmunizationManual,
} from "./types.js";

// FHIR R4 datatypes (re-exported for users building PatientFull input)
export type {
  HumanName,
  Address,
  ContactPoint,
  Identifier,
  CodeableConcept,
  Reference,
  Coding,
  Period,
  AdministrativeGender,
} from "./fhir-types.js";
