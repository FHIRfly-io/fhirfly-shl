// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import type {
  PatientDemographics,
  BuildOptions,
  ValidationResult,
  ValidationIssue,
  MedicationOptions,
  AllergyOptions,
  ConditionOptions,
  ImmunizationOptions,
} from "./types.js";
import { normalizePatient, isPatientFull } from "./patient.js";
import { resolveMedications, validateFromResource } from "./medication.js";
import { resolveConditions, validateConditionFromResource } from "./condition.js";
import { resolveAllergies, validateAllergyFromResource } from "./allergy.js";
import { resolveImmunizations, validateImmunizationFromResource } from "./immunization.js";

/**
 * Builder for creating IPS (International Patient Summary) FHIR bundles.
 *
 * @example
 * ```ts
 * const bundle = new IPS.Bundle({
 *   given: "Jane",
 *   family: "Doe",
 *   birthDate: "1990-01-15",
 *   gender: "female",
 * });
 *
 * bundle.addMedication({
 *   code: "860975",
 *   system: "http://www.nlm.nih.gov/research/umls/rxnorm",
 *   display: "Metformin 500 MG Oral Tablet",
 *   status: "active",
 * });
 *
 * const fhirBundle = await bundle.build({ profile: "ips" });
 * ```
 */
export class Bundle {
  private readonly _patient: PatientDemographics;
  private readonly _medications: MedicationOptions[] = [];
  private readonly _allergies: AllergyOptions[] = [];
  private readonly _conditions: ConditionOptions[] = [];
  private readonly _immunizations: ImmunizationOptions[] = [];
  private readonly _warnings: ValidationIssue[] = [];
  private _buildWarnings: ValidationIssue[] = [];

  constructor(patient: PatientDemographics) {
    this._patient = patient;
  }

  /** Returns the patient demographics for this bundle. */
  get patient(): PatientDemographics {
    return this._patient;
  }

  /** Returns all warnings collected from add-time and build-time. */
  get warnings(): readonly ValidationIssue[] {
    return [...this._warnings, ...this._buildWarnings];
  }

  /**
   * Add a medication statement to the IPS bundle.
   *
   * Throws immediately for `fromResource` with wrong resourceType.
   * All other validation happens at build time.
   */
  addMedication(medication: MedicationOptions): this {
    // Eagerly validate fromResource resourceType
    if ("fromResource" in medication && medication.fromResource !== undefined) {
      validateFromResource(medication.fromResource);

      // Warn on missing fields (collected, not thrown)
      const resource = medication.fromResource;
      if (!resource.status) {
        this._warnings.push({
          severity: "warning",
          message: `fromResource missing "status" — will default to "active"`,
          path: `${String(resource.resourceType)}.status`,
        });
      }
      if (!resource.medicationCodeableConcept) {
        this._warnings.push({
          severity: "warning",
          message: `fromResource missing "medicationCodeableConcept"`,
          path: `${String(resource.resourceType)}.medicationCodeableConcept`,
        });
      }
    }

    this._medications.push(medication);
    return this;
  }

  /**
   * Add an allergy/intolerance to the IPS bundle.
   *
   * Throws immediately for `fromResource` with wrong resourceType.
   */
  addAllergy(allergy: AllergyOptions): this {
    if ("fromResource" in allergy && allergy.fromResource !== undefined) {
      validateAllergyFromResource(allergy.fromResource);

      const resource = allergy.fromResource;
      if (!resource.clinicalStatus) {
        this._warnings.push({
          severity: "warning",
          message: `fromResource missing "clinicalStatus" — will default to "active"`,
          path: "AllergyIntolerance.clinicalStatus",
        });
      }
      if (!resource.code) {
        this._warnings.push({
          severity: "warning",
          message: `fromResource missing "code"`,
          path: "AllergyIntolerance.code",
        });
      }
    }

    this._allergies.push(allergy);
    return this;
  }

  /**
   * Add a condition/problem to the IPS bundle.
   *
   * Throws immediately for `fromResource` with wrong resourceType.
   */
  addCondition(condition: ConditionOptions): this {
    if ("fromResource" in condition && condition.fromResource !== undefined) {
      validateConditionFromResource(condition.fromResource);

      const resource = condition.fromResource;
      if (!resource.clinicalStatus) {
        this._warnings.push({
          severity: "warning",
          message: `fromResource missing "clinicalStatus" — will default to "active"`,
          path: "Condition.clinicalStatus",
        });
      }
      if (!resource.code) {
        this._warnings.push({
          severity: "warning",
          message: `fromResource missing "code"`,
          path: "Condition.code",
        });
      }
    }

    this._conditions.push(condition);
    return this;
  }

  /**
   * Add an immunization to the IPS bundle.
   *
   * Throws immediately for `fromResource` with wrong resourceType.
   */
  addImmunization(immunization: ImmunizationOptions): this {
    if ("fromResource" in immunization && immunization.fromResource !== undefined) {
      validateImmunizationFromResource(immunization.fromResource);

      const resource = immunization.fromResource;
      if (!resource.status) {
        this._warnings.push({
          severity: "warning",
          message: `fromResource missing "status" — will default to "completed"`,
          path: "Immunization.status",
        });
      }
      if (!resource.vaccineCode) {
        this._warnings.push({
          severity: "warning",
          message: `fromResource missing "vaccineCode"`,
          path: "Immunization.vaccineCode",
        });
      }
    }

    this._immunizations.push(immunization);
    return this;
  }

  /**
   * Build the IPS FHIR Bundle resource.
   *
   * Async because `byNDC`, `byRxNorm`, `byICD10`, and `byCVX` require API enrichment.
   * If no enrichment is needed, the Promise resolves immediately.
   *
   * @returns A FHIR Bundle resource object
   */
  async build(options?: BuildOptions): Promise<Record<string, unknown>> {
    const profile = options?.profile ?? "ips";
    const bundleId = options?.bundleId ?? generateUuid();
    const compositionId = generateUuid();
    const patientId = generateUuid();
    const compositionDate = options?.compositionDate ?? new Date().toISOString();

    const patientFullUrl = `urn:uuid:${patientId}`;
    const compositionFullUrl = `urn:uuid:${compositionId}`;

    // Build Patient resource
    const patientResource = normalizePatient(this._patient, patientId, profile);

    // Resolve all resource types
    const [medResult, condResult, allergyResult, immResult] = await Promise.all([
      resolveMedications(this._medications, patientFullUrl, profile, generateUuid),
      resolveConditions(this._conditions, patientFullUrl, profile, generateUuid),
      resolveAllergies(this._allergies, patientFullUrl, profile, generateUuid),
      resolveImmunizations(this._immunizations, patientFullUrl, profile, generateUuid),
    ]);

    this._buildWarnings = [
      ...medResult.warnings,
      ...condResult.warnings,
      ...allergyResult.warnings,
      ...immResult.warnings,
    ];

    // Build section references for the Composition
    const medRefs = medResult.entries.map((e) => ({ reference: e.fullUrl }));
    const condRefs = condResult.entries.map((e) => ({ reference: e.fullUrl }));
    const allergyRefs = allergyResult.entries.map((e) => ({ reference: e.fullUrl }));
    const immRefs = immResult.entries.map((e) => ({ reference: e.fullUrl }));

    // Build Composition resource
    const composition = this.buildComposition(
      compositionId,
      patientFullUrl,
      compositionDate,
      profile,
      medRefs,
      allergyRefs,
      condRefs,
      immRefs,
    );

    // Assemble Bundle: Composition, Patient, then clinical entries
    const entries: Array<{ fullUrl: string; resource: Record<string, unknown> }> = [
      { fullUrl: compositionFullUrl, resource: composition },
      { fullUrl: patientFullUrl, resource: patientResource },
      ...medResult.entries,
      ...condResult.entries,
      ...allergyResult.entries,
      ...immResult.entries,
    ];

    const bundle: Record<string, unknown> = {
      resourceType: "Bundle",
      id: bundleId,
      identifier: {
        system: "urn:ietf:rfc:3986",
        value: `urn:uuid:${bundleId}`,
      },
      type: "document",
      timestamp: compositionDate,
      entry: entries,
    };

    return bundle;
  }

  /**
   * Validate the bundle against the specified profile.
   *
   * @returns Validation result with any issues found
   */
  validate(options?: BuildOptions): ValidationResult {
    const profile = options?.profile ?? "ips";
    const issues: ValidationIssue[] = [];

    // Check birthDate format (YYYY-MM-DD)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(this._patient.birthDate)) {
      issues.push({
        severity: "error",
        message: "birthDate must be in YYYY-MM-DD format",
        path: "Patient.birthDate",
      });
    }

    // IPS-specific checks
    if (profile === "ips") {
      // ips-pat-1: name must have given, family, or text
      if (!this.hasValidName()) {
        issues.push({
          severity: "error",
          message: "Patient.name must have at least a given, family, or text (ips-pat-1)",
          path: "Patient.name",
        });
      }

      // Gender recommended by IPS
      if (!this._patient.gender) {
        issues.push({
          severity: "warning",
          message: "Patient.gender is recommended by the IPS profile",
          path: "Patient.gender",
        });
      }

      // Check medications for missing effectiveDate
      for (const med of this._medications) {
        if ("fromResource" in med && med.fromResource !== undefined) {
          const r = med.fromResource;
          if (!r.effectiveDateTime && !r.effectivePeriod) {
            issues.push({
              severity: "warning",
              message: "fromResource MedicationStatement missing effective[x] — IPS requires effectiveDateTime or effectivePeriod",
              path: "MedicationStatement.effective[x]",
            });
          }
        } else if (!("fromResource" in med) && !("effectiveDate" in med && med.effectiveDate)) {
          issues.push({
            severity: "information",
            message: "Medication has no effectiveDate — the SDK will default to today's date",
            path: "MedicationStatement.effectiveDateTime",
          });
        }
      }

      // Check conditions for missing onsetDate
      for (const cond of this._conditions) {
        if (!("fromResource" in cond && cond.fromResource !== undefined) && !("onsetDate" in cond && cond.onsetDate)) {
          issues.push({
            severity: "information",
            message: "Condition has no onsetDate — recommended by IPS but not required",
            path: "Condition.onsetDateTime",
          });
        }
      }

      // Check immunizations for missing occurrenceDate
      for (const imm of this._immunizations) {
        if (!("fromResource" in imm && imm.fromResource !== undefined) && !("occurrenceDate" in imm && imm.occurrenceDate)) {
          issues.push({
            severity: "information",
            message: "Immunization has no occurrenceDate — recommended by IPS but not required",
            path: "Immunization.occurrenceDateTime",
          });
        }
      }
    }

    return {
      valid: issues.filter((i) => i.severity === "error").length === 0,
      issues,
    };
  }

  private hasValidName(): boolean {
    if (isPatientFull(this._patient)) {
      // Full: at least one name entry with given, family, or text
      return this._patient.name.some(
        (n) => n.text || n.family || (n.given && n.given.length > 0),
      );
    }
    // Shorthand: has given, family, or name (text)
    const s = this._patient;
    return !!(s.given || s.family || s.name);
  }

  private buildComposition(
    id: string,
    patientRef: string,
    date: string,
    profile: "ips" | "r4",
    medRefs: Array<{ reference: string }>,
    allergyRefs: Array<{ reference: string }>,
    condRefs: Array<{ reference: string }>,
    immRefs: Array<{ reference: string }>,
  ): Record<string, unknown> {
    const composition: Record<string, unknown> = {
      resourceType: "Composition",
      id,
      status: "final",
      type: {
        coding: [
          {
            system: "http://loinc.org",
            code: "60591-5",
            display: "Patient summary Document",
          },
        ],
      },
      subject: { reference: patientRef },
      date,
      author: [{ display: "FHIRfly SHL SDK" }],
      title: "International Patient Summary",
    };

    if (profile === "ips") {
      composition.meta = {
        profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/Composition-uv-ips"],
      };
    }

    // Required IPS sections
    if (profile === "ips") {
      const sections: Array<Record<string, unknown>> = [
        this.buildMedicationSection(medRefs),
        this.buildAllergySection(allergyRefs),
        this.buildConditionSection(condRefs),
      ];

      // Immunization section is only included when there are entries
      // (it's not one of the 3 required IPS sections)
      if (immRefs.length > 0) {
        sections.push(this.buildImmunizationSection(immRefs));
      }

      composition.section = sections;
    }

    return composition;
  }

  private buildMedicationSection(
    medRefs: Array<{ reference: string }>,
  ): Record<string, unknown> {
    return this.buildDynamicSection(
      "Medication Summary",
      "http://loinc.org",
      "10160-0",
      "History of Medication use Narrative",
      medRefs,
      "medication",
    );
  }

  private buildAllergySection(
    allergyRefs: Array<{ reference: string }>,
  ): Record<string, unknown> {
    return this.buildDynamicSection(
      "Allergies and Intolerances",
      "http://loinc.org",
      "48765-2",
      "Allergies and adverse reactions Document",
      allergyRefs,
      "allergy",
    );
  }

  private buildConditionSection(
    condRefs: Array<{ reference: string }>,
  ): Record<string, unknown> {
    return this.buildDynamicSection(
      "Problem List",
      "http://loinc.org",
      "11450-4",
      "Problem list - Reported",
      condRefs,
      "condition",
    );
  }

  private buildImmunizationSection(
    immRefs: Array<{ reference: string }>,
  ): Record<string, unknown> {
    return this.buildDynamicSection(
      "History of Immunizations",
      "http://loinc.org",
      "11369-6",
      "History of Immunization note",
      immRefs,
      "immunization",
    );
  }

  private buildDynamicSection(
    title: string,
    system: string,
    code: string,
    display: string,
    refs: Array<{ reference: string }>,
    resourceLabel: string,
  ): Record<string, unknown> {
    const section: Record<string, unknown> = {
      title,
      code: {
        coding: [{ system, code, display }],
      },
    };

    if (refs.length > 0) {
      section.text = {
        status: "generated",
        div: `<div xmlns="http://www.w3.org/1999/xhtml"><p>${refs.length} ${resourceLabel}(s)</p></div>`,
      };
      section.entry = refs;
    } else {
      section.text = {
        status: "empty",
        div: '<div xmlns="http://www.w3.org/1999/xhtml"><p>No information available</p></div>',
      };
      section.emptyReason = {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/list-empty-reason",
            code: "notasked",
          },
        ],
      };
    }

    return section;
  }
}

/** Generate a v4-style UUID using Math.random (no crypto dependency). */
function generateUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
