// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
/**
 * Internal allergy resolution — converts allergy input variants
 * into resolved allergies and then into FHIR AllergyIntolerance resources.
 */

import { CODE_SYSTEMS } from "./code-systems.js";
import { allergyNarrative } from "./narrative.js";
import type {
  AllergyOptions,
  AllergyBySNOMED,
  AllergyFromResource,
  AllergyManual,
  ResolvedAllergy,
  ValidationIssue,
} from "./types.js";

/** Result of resolving all allergies — includes build-time warnings. */
export interface AllergyResolutionResult {
  entries: Array<{ fullUrl: string; resource: Record<string, unknown> }>;
  warnings: ValidationIssue[];
}

/**
 * Resolve all allergy inputs into FHIR AllergyIntolerance Bundle entries.
 */
export async function resolveAllergies(
  allergies: AllergyOptions[],
  patientRef: string,
  profile: "ips" | "r4",
  generateUuid: () => string,
): Promise<AllergyResolutionResult> {
  const entries: Array<{ fullUrl: string; resource: Record<string, unknown> }> = [];
  const warnings: ValidationIssue[] = [];

  for (const allergy of allergies) {
    const resolved = await resolveSingle(allergy, warnings);

    if (resolved.originalResource) {
      const id = generateUuid();
      const resource = { ...resolved.originalResource };
      resource.id = id;
      resource.patient = { reference: patientRef };

      if (profile === "ips") {
        resource.meta = {
          profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/AllergyIntolerance-uv-ips"],
        };
      }

      entries.push({ fullUrl: `urn:uuid:${id}`, resource });
    } else {
      const id = generateUuid();
      const resource = buildAllergyIntolerance(resolved, id, patientRef, profile);
      entries.push({ fullUrl: `urn:uuid:${id}`, resource });
    }
  }

  return { entries, warnings };
}

async function resolveSingle(
  allergy: AllergyOptions,
  warnings: ValidationIssue[],
): Promise<ResolvedAllergy> {
  if ("bySNOMED" in allergy && allergy.bySNOMED !== undefined) {
    return resolveSNOMED(allergy as AllergyBySNOMED, warnings);
  }
  if ("fromResource" in allergy && allergy.fromResource !== undefined) {
    return resolvePassthrough(allergy as AllergyFromResource, warnings);
  }
  return resolveManual(allergy as AllergyManual);
}

async function resolveSNOMED(
  allergy: AllergyBySNOMED,
  warnings: ValidationIssue[],
): Promise<ResolvedAllergy> {
  let display = allergy.display;

  if (allergy.fhirfly) {
    try {
      const result = await allergy.fhirfly.snomed.lookup(allergy.bySNOMED);
      if (result.data.preferred_term) {
        display = result.data.preferred_term;
      }
    } catch {
      warnings.push({
        severity: "warning",
        message: `SNOMED lookup failed for "${allergy.bySNOMED}" — using provided display`,
        path: "AllergyIntolerance.code",
      });
    }
  }

  if (!display) {
    warnings.push({
      severity: "warning",
      message: `No display name for SNOMED code "${allergy.bySNOMED}"`,
      path: "AllergyIntolerance.code",
    });
  }

  return {
    codings: [{ system: CODE_SYSTEMS.SNOMED, code: allergy.bySNOMED, display }],
    text: display,
    clinicalStatus: allergy.clinicalStatus ?? "active",
    criticality: allergy.criticality,
  };
}

function resolveManual(allergy: AllergyManual): ResolvedAllergy {
  return {
    codings: [{ system: allergy.system, code: allergy.code, display: allergy.display }],
    text: allergy.display,
    clinicalStatus: allergy.clinicalStatus ?? "active",
    criticality: allergy.criticality,
  };
}

async function resolvePassthrough(
  allergy: AllergyFromResource,
  warnings: ValidationIssue[],
): Promise<ResolvedAllergy> {
  const resource = allergy.fromResource;

  validateAllergyFromResource(resource);

  if (!resource.clinicalStatus) {
    warnings.push({
      severity: "warning",
      message: `fromResource missing "clinicalStatus" — will default to "active"`,
      path: "AllergyIntolerance.clinicalStatus",
    });
  }

  if (!resource.code) {
    warnings.push({
      severity: "warning",
      message: `fromResource missing "code"`,
      path: "AllergyIntolerance.code",
    });
  }

  return {
    codings: [],
    clinicalStatus: "active",
    originalResource: resource,
  };
}

/** Throws if resourceType is not AllergyIntolerance. */
export function validateAllergyFromResource(resource: Record<string, unknown>): void {
  const rt = resource.resourceType;
  if (rt !== "AllergyIntolerance") {
    throw new Error(
      `fromResource requires resourceType "AllergyIntolerance", got "${String(rt)}"`,
    );
  }
}

/** Assemble a FHIR AllergyIntolerance resource from a resolved allergy. */
function buildAllergyIntolerance(
  resolved: ResolvedAllergy,
  id: string,
  patientRef: string,
  profile: "ips" | "r4",
): Record<string, unknown> {
  const resource: Record<string, unknown> = {
    resourceType: "AllergyIntolerance",
    id,
    clinicalStatus: {
      coding: [
        {
          system: CODE_SYSTEMS.ALLERGY_CLINICAL,
          code: resolved.clinicalStatus,
        },
      ],
    },
    code: {
      coding: resolved.codings.map((c) => {
        const coding: Record<string, string> = { system: c.system, code: c.code };
        if (c.display) coding.display = c.display;
        return coding;
      }),
      ...(resolved.text ? { text: resolved.text } : {}),
    },
    patient: { reference: patientRef },
  };

  if (profile === "ips") {
    resource.meta = {
      profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/AllergyIntolerance-uv-ips"],
    };
  }

  if (resolved.criticality) {
    resource.criticality = resolved.criticality;
  }

  resource.text = {
    status: "generated",
    div: allergyNarrative(resolved.text, resolved.clinicalStatus, resolved.criticality),
  };

  return resource;
}
