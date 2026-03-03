// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
/** Well-known FHIR code system URIs used across IPS resource generation. */
export const CODE_SYSTEMS = {
  NDC: "http://hl7.org/fhir/sid/ndc",
  RXNORM: "http://www.nlm.nih.gov/research/umls/rxnorm",
  SNOMED: "http://snomed.info/sct",
  LOINC: "http://loinc.org",
  CVX: "http://hl7.org/fhir/sid/cvx",
  ICD10CM: "http://hl7.org/fhir/sid/icd-10-cm",
  CONDITION_CLINICAL: "http://terminology.hl7.org/CodeSystem/condition-clinical",
  ALLERGY_CLINICAL: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
  /** CMS Patient-Shared Health Document category code system */
  CMS_PATIENT_SHARED_CATEGORY: "https://cms.gov/fhir/CodeSystem/patient-shared-category",
  /** V3 ActCode security label for patient-asserted data */
  SECURITY_PATAST: "PATAST",
} as const;
