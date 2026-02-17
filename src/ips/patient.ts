// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
/**
 * Internal patient normalization — converts shorthand or full FHIR-shaped
 * patient input into a FHIR R4 Patient resource object.
 */

import type { PatientDemographics, PatientFull, PatientShorthand } from "./types.js";
import type { HumanName, ContactPoint, Identifier } from "./fhir-types.js";
import { patientNarrative } from "./narrative.js";

/**
 * Type guard: returns true if the input is a full FHIR-shaped patient.
 * Discriminant: `Array.isArray(input.name)`.
 */
export function isPatientFull(input: PatientDemographics): input is PatientFull {
  return Array.isArray((input as PatientFull).name);
}

/**
 * Convert either patient input form to a FHIR R4 Patient resource object.
 */
export function normalizePatient(
  input: PatientDemographics,
  id: string,
  profile: "ips" | "r4",
): Record<string, unknown> {
  if (isPatientFull(input)) {
    return buildFromFull(input, id, profile);
  }
  return buildFromShorthand(input, id, profile);
}

function buildFromShorthand(
  input: PatientShorthand,
  id: string,
  profile: "ips" | "r4",
): Record<string, unknown> {
  const patient: Record<string, unknown> = {
    resourceType: "Patient",
    id,
  };

  if (profile === "ips") {
    patient.meta = {
      profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/Patient-uv-ips"],
    };
  }

  // Name: given/family or text
  const name: HumanName = {};
  if (input.given) name.given = [input.given];
  if (input.family) name.family = input.family;
  if (input.name) name.text = input.name;
  if (name.given || name.family || name.text) {
    patient.name = [name];
  }

  patient.birthDate = input.birthDate;

  if (input.gender) {
    patient.gender = input.gender;
  }

  // Telecom: phone, email
  const telecom: ContactPoint[] = [];
  if (input.phone) {
    telecom.push({ system: "phone", value: input.phone });
  }
  if (input.email) {
    telecom.push({ system: "email", value: input.email });
  }
  if (telecom.length > 0) {
    patient.telecom = telecom;
  }

  // Identifier
  if (input.identifier) {
    const ident: Identifier = typeof input.identifier === "string"
      ? { value: input.identifier }
      : { system: input.identifier.system, value: input.identifier.value };
    patient.identifier = [ident];
  }

  const displayName = (input.name
    ?? [input.given, input.family].filter(Boolean).join(" "))
    || undefined;
  patient.text = {
    status: "generated",
    div: patientNarrative(displayName, input.birthDate, input.gender),
  };

  return patient;
}

function buildFromFull(
  input: PatientFull,
  id: string,
  profile: "ips" | "r4",
): Record<string, unknown> {
  const patient: Record<string, unknown> = {
    resourceType: "Patient",
    id,
  };

  if (profile === "ips") {
    patient.meta = {
      profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/Patient-uv-ips"],
    };
  }

  patient.name = input.name;
  patient.birthDate = input.birthDate;

  if (input.gender) patient.gender = input.gender;
  if (input.identifier) patient.identifier = input.identifier;
  if (input.telecom) patient.telecom = input.telecom;
  if (input.address) patient.address = input.address;
  if (input.active !== undefined) patient.active = input.active;
  if (input.maritalStatus) patient.maritalStatus = input.maritalStatus;
  if (input.generalPractitioner) patient.generalPractitioner = input.generalPractitioner;
  if (input.communication) patient.communication = input.communication;
  if (input.contact) patient.contact = input.contact;

  // Deceased polymorphism: boolean → deceasedBoolean, string → deceasedDateTime
  if (input.deceased !== undefined) {
    if (typeof input.deceased === "boolean") {
      patient.deceasedBoolean = input.deceased;
    } else {
      patient.deceasedDateTime = input.deceased;
    }
  }

  const first = input.name[0];
  const displayName = first
    ? (first.text ?? [first.given?.join(" "), first.family].filter(Boolean).join(" ")) || undefined
    : undefined;
  patient.text = {
    status: "generated",
    div: patientNarrative(displayName, input.birthDate, input.gender),
  };

  return patient;
}
