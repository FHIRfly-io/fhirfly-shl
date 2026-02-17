// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
/**
 * Internal medication resolution — converts the 5 medication input variants
 * into resolved medications and then into FHIR MedicationStatement resources.
 */

import { CODE_SYSTEMS } from "./code-systems.js";
import { medicationNarrative } from "./narrative.js";
import type {
  MedicationOptions,
  MedicationByNDC,
  MedicationByRxNorm,
  MedicationBySNOMED,
  MedicationFromResource,
  MedicationManual,
  ResolvedMedication,
  ResolvedCoding,
  ValidationIssue,
  FhirflyClient,
} from "./types.js";

/** Result of resolving all medications — includes build-time warnings. */
export interface MedicationResolutionResult {
  entries: Array<{ fullUrl: string; resource: Record<string, unknown> }>;
  warnings: ValidationIssue[];
}

/**
 * Resolve all medication inputs into FHIR MedicationStatement Bundle entries.
 */
export async function resolveMedications(
  meds: MedicationOptions[],
  patientRef: string,
  profile: "ips" | "r4",
  generateUuid: () => string,
): Promise<MedicationResolutionResult> {
  const entries: Array<{ fullUrl: string; resource: Record<string, unknown> }> = [];
  const warnings: ValidationIssue[] = [];

  for (const med of meds) {
    const resolved = await resolveSingle(med, warnings);

    if (resolved.originalResource) {
      // fromResource passthrough — rewrite subject and assign ID
      const id = generateUuid();
      const resource = { ...resolved.originalResource };
      resource.id = id;
      resource.subject = { reference: patientRef };

      if (profile === "ips" && resource.resourceType === "MedicationStatement") {
        resource.meta = {
          profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/MedicationStatement-uv-ips"],
        };
      }

      entries.push({ fullUrl: `urn:uuid:${id}`, resource });
    } else {
      const id = generateUuid();
      const resource = buildMedicationStatement(resolved, id, patientRef, profile);
      entries.push({ fullUrl: `urn:uuid:${id}`, resource });
    }
  }

  return { entries, warnings };
}

async function resolveSingle(
  med: MedicationOptions,
  warnings: ValidationIssue[],
): Promise<ResolvedMedication> {
  if ("byNDC" in med && med.byNDC !== undefined) {
    return resolveNDC(med as MedicationByNDC, warnings);
  }
  if ("byRxNorm" in med && med.byRxNorm !== undefined) {
    return resolveRxNorm(med as MedicationByRxNorm, warnings);
  }
  if ("bySNOMED" in med && med.bySNOMED !== undefined) {
    return resolveSNOMED(med as MedicationBySNOMED, warnings);
  }
  if ("fromResource" in med && med.fromResource !== undefined) {
    return resolvePassthrough(med as MedicationFromResource, warnings);
  }
  return resolveManual(med as MedicationManual);
}

async function resolveNDC(
  med: MedicationByNDC,
  warnings: ValidationIssue[],
): Promise<ResolvedMedication> {
  const codings: ResolvedCoding[] = [{ system: CODE_SYSTEMS.NDC, code: med.byNDC }];
  let text: string | undefined;

  try {
    const result = await med.fhirfly.ndc.lookup(med.byNDC, { shape: "full" });
    const data = result.data;

    codings[0]!.display = data.product_name;
    text = data.product_name;

    // Add SNOMED codings if available (only equivalent mappings for IPS)
    if (data.snomed) {
      for (const s of data.snomed) {
        if (s.map_type && s.map_type.toLowerCase() !== "equivalent") continue;
        codings.push({
          system: CODE_SYSTEMS.SNOMED,
          code: s.concept_id,
          display: s.display,
        });
      }
    }
  } catch {
    warnings.push({
      severity: "warning",
      message: `NDC lookup failed for "${med.byNDC}" — included with bare code`,
      path: "MedicationStatement.medicationCodeableConcept",
    });
  }

  return {
    codings,
    text,
    status: med.status ?? "active",
    dosageText: med.dosageText,
    effectiveDate: med.effectiveDate,
  };
}

async function resolveRxNorm(
  med: MedicationByRxNorm,
  warnings: ValidationIssue[],
): Promise<ResolvedMedication> {
  const codings: ResolvedCoding[] = [{ system: CODE_SYSTEMS.RXNORM, code: med.byRxNorm }];
  let text: string | undefined;

  try {
    const result = await med.fhirfly.rxnorm.lookup(med.byRxNorm, { shape: "full" });
    const data = result.data;

    codings[0]!.display = data.name;
    text = data.name;

    // Add SNOMED codings if available (only equivalent mappings for IPS)
    if (data.snomed) {
      for (const s of data.snomed) {
        if (s.map_type && s.map_type.toLowerCase() !== "equivalent") continue;
        codings.push({
          system: CODE_SYSTEMS.SNOMED,
          code: s.concept_id,
          display: s.display,
        });
      }
    }
  } catch {
    warnings.push({
      severity: "warning",
      message: `RxNorm lookup failed for "${med.byRxNorm}" — included with bare code`,
      path: "MedicationStatement.medicationCodeableConcept",
    });
  }

  return {
    codings,
    text,
    status: med.status ?? "active",
    dosageText: med.dosageText,
    effectiveDate: med.effectiveDate,
  };
}

async function resolveSNOMED(
  med: MedicationBySNOMED,
  warnings: ValidationIssue[],
): Promise<ResolvedMedication> {
  let display = med.display;

  // If fhirfly provided, look up preferred_term
  if (med.fhirfly) {
    try {
      const result = await med.fhirfly.snomed.lookup(med.bySNOMED);
      if (result.data.preferred_term) {
        display = result.data.preferred_term;
      }
    } catch {
      warnings.push({
        severity: "warning",
        message: `SNOMED lookup failed for "${med.bySNOMED}" — using provided display`,
        path: "MedicationStatement.medicationCodeableConcept",
      });
    }
  }

  if (!display) {
    warnings.push({
      severity: "warning",
      message: `No display name for SNOMED code "${med.bySNOMED}"`,
      path: "MedicationStatement.medicationCodeableConcept",
    });
  }

  return {
    codings: [{ system: CODE_SYSTEMS.SNOMED, code: med.bySNOMED, display }],
    text: display,
    status: med.status ?? "active",
    dosageText: med.dosageText,
    effectiveDate: med.effectiveDate,
  };
}

function resolveManual(med: MedicationManual): ResolvedMedication {
  return {
    codings: [{ system: med.system, code: med.code, display: med.display }],
    text: med.display,
    status: med.status ?? "active",
    dosageText: med.dosageText,
    effectiveDate: med.effectiveDate,
  };
}

async function resolvePassthrough(
  med: MedicationFromResource,
  warnings: ValidationIssue[],
): Promise<ResolvedMedication> {
  const resource = med.fromResource;

  // Validate resourceType — error at resolve time
  validateFromResource(resource);

  // Warn on missing status
  if (!resource.status) {
    warnings.push({
      severity: "warning",
      message: `fromResource missing "status" — will default to "active"`,
      path: `${String(resource.resourceType)}.status`,
    });
  }

  // Warn on missing medicationCodeableConcept
  if (!resource.medicationCodeableConcept) {
    warnings.push({
      severity: "warning",
      message: `fromResource missing "medicationCodeableConcept"`,
      path: `${String(resource.resourceType)}.medicationCodeableConcept`,
    });
  }

  // If fhirfly provided, try to add SNOMED codings from existing NDC/RxNorm codes
  if (med.fhirfly && resource.medicationCodeableConcept) {
    await enrichPassthroughWithSNOMED(resource, med.fhirfly, warnings);
  }

  return {
    codings: [],
    status: (resource.status as string as ResolvedMedication["status"]) ?? "active",
    originalResource: resource,
  };
}

/** Throws if resourceType is not MedicationStatement or MedicationRequest. */
export function validateFromResource(resource: Record<string, unknown>): void {
  const rt = resource.resourceType;
  if (rt !== "MedicationStatement" && rt !== "MedicationRequest") {
    throw new Error(
      `fromResource requires resourceType "MedicationStatement" or "MedicationRequest", got "${String(rt)}"`,
    );
  }
}

async function enrichPassthroughWithSNOMED(
  resource: Record<string, unknown>,
  fhirfly: FhirflyClient,
  warnings: ValidationIssue[],
): Promise<void> {
  const medCC = resource.medicationCodeableConcept as
    | { coding?: Array<{ system?: string; code?: string; display?: string }>; text?: string }
    | undefined;
  if (!medCC?.coding) return;

  // Check if SNOMED coding already exists
  const hasSNOMED = medCC.coding.some((c) => c.system === CODE_SYSTEMS.SNOMED);
  if (hasSNOMED) return;

  // Find NDC or RxNorm codes to look up
  const ndcCoding = medCC.coding.find((c) => c.system === CODE_SYSTEMS.NDC);
  const rxnormCoding = medCC.coding.find((c) => c.system === CODE_SYSTEMS.RXNORM);

  const newCodings: Array<{ system: string; code: string; display?: string }> = [];

  if (ndcCoding?.code) {
    try {
      const result = await fhirfly.ndc.lookup(ndcCoding.code, { shape: "full" });
      if (result.data.snomed) {
        for (const s of result.data.snomed) {
          if (s.map_type && s.map_type.toLowerCase() !== "equivalent") continue;
          newCodings.push({ system: CODE_SYSTEMS.SNOMED, code: s.concept_id, display: s.display });
        }
      }
    } catch {
      warnings.push({
        severity: "warning",
        message: `NDC→SNOMED enrichment failed for "${ndcCoding.code}" on fromResource`,
        path: "MedicationStatement.medicationCodeableConcept",
      });
    }
  } else if (rxnormCoding?.code) {
    try {
      const result = await fhirfly.rxnorm.lookup(rxnormCoding.code, { shape: "full" });
      if (result.data.snomed) {
        for (const s of result.data.snomed) {
          if (s.map_type && s.map_type.toLowerCase() !== "equivalent") continue;
          newCodings.push({ system: CODE_SYSTEMS.SNOMED, code: s.concept_id, display: s.display });
        }
      }
    } catch {
      warnings.push({
        severity: "warning",
        message: `RxNorm→SNOMED enrichment failed for "${rxnormCoding.code}" on fromResource`,
        path: "MedicationStatement.medicationCodeableConcept",
      });
    }
  }

  if (newCodings.length > 0) {
    medCC.coding.push(...newCodings);
  }
}

/** Assemble a FHIR MedicationStatement resource from a resolved medication. */
function buildMedicationStatement(
  resolved: ResolvedMedication,
  id: string,
  patientRef: string,
  profile: "ips" | "r4",
): Record<string, unknown> {
  const resource: Record<string, unknown> = {
    resourceType: "MedicationStatement",
    id,
    status: resolved.status,
    medicationCodeableConcept: {
      coding: resolved.codings.map((c) => {
        const coding: Record<string, string> = { system: c.system, code: c.code };
        if (c.display) coding.display = c.display;
        return coding;
      }),
      ...(resolved.text ? { text: resolved.text } : {}),
    },
    subject: { reference: patientRef },
    effectiveDateTime: resolved.effectiveDate ?? new Date().toISOString().split("T")[0],
  };

  if (profile === "ips") {
    resource.meta = {
      profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/MedicationStatement-uv-ips"],
    };
  }

  if (resolved.dosageText) {
    resource.dosage = [{ text: resolved.dosageText }];
  }

  resource.text = {
    status: "generated",
    div: medicationNarrative(resolved.text, resolved.dosageText, resolved.effectiveDate),
  };

  return resource;
}
