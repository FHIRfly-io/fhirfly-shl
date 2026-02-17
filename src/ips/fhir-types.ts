// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
/**
 * Shared FHIR R4 datatypes used across IPS bundle construction.
 *
 * These types cover the subset of R4 datatypes needed for Patient resources
 * and IPS document generation. All coded fields use string literal unions.
 */

/** FHIR Coding element — a code from a terminology system. */
export interface Coding {
  system?: string;
  version?: string;
  code?: string;
  display?: string;
}

/** FHIR CodeableConcept — a set of codes with optional text. */
export interface CodeableConcept {
  coding?: Coding[];
  text?: string;
}

/** FHIR HumanName — a name of a person. */
export interface HumanName {
  use?: "usual" | "official" | "temp" | "nickname" | "anonymous" | "old" | "maiden";
  text?: string;
  family?: string;
  given?: string[];
  prefix?: string[];
  suffix?: string[];
}

/** FHIR Address — a postal/physical address. */
export interface Address {
  use?: "home" | "work" | "temp" | "old" | "billing";
  type?: "postal" | "physical" | "both";
  text?: string;
  line?: string[];
  city?: string;
  district?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

/** FHIR ContactPoint — phone, email, or other contact mechanism. */
export interface ContactPoint {
  system?: "phone" | "fax" | "email" | "pager" | "url" | "sms" | "other";
  value?: string;
  use?: "home" | "work" | "temp" | "old" | "mobile";
  rank?: number;
}

/** FHIR Identifier — a business identifier for an entity. */
export interface Identifier {
  use?: "usual" | "official" | "temp" | "secondary" | "old";
  system?: string;
  value?: string;
}

/** FHIR Reference — a reference to another resource. */
export interface Reference {
  reference?: string;
  display?: string;
}

/** FHIR Period — a time range. */
export interface Period {
  start?: string;
  end?: string;
}

/** FHIR R4 administrative gender values. */
export type AdministrativeGender = "male" | "female" | "other" | "unknown";
