/**
 * Internal condition resolution — converts condition input variants
 * into resolved conditions and then into FHIR Condition resources.
 */

import { CODE_SYSTEMS } from "./code-systems.js";
import type {
  ConditionOptions,
  ConditionByICD10,
  ConditionBySNOMED,
  ConditionFromResource,
  ConditionManual,
  ResolvedCondition,
  ResolvedCoding,
  ValidationIssue,
  FhirflyClient,
} from "./types.js";

/** Result of resolving all conditions — includes build-time warnings. */
export interface ConditionResolutionResult {
  entries: Array<{ fullUrl: string; resource: Record<string, unknown> }>;
  warnings: ValidationIssue[];
}

/**
 * Resolve all condition inputs into FHIR Condition Bundle entries.
 */
export async function resolveConditions(
  conditions: ConditionOptions[],
  patientRef: string,
  profile: "ips" | "r4",
  generateUuid: () => string,
): Promise<ConditionResolutionResult> {
  const entries: Array<{ fullUrl: string; resource: Record<string, unknown> }> = [];
  const warnings: ValidationIssue[] = [];

  for (const cond of conditions) {
    const resolved = await resolveSingle(cond, warnings);

    if (resolved.originalResource) {
      const id = generateUuid();
      const resource = { ...resolved.originalResource };
      resource.id = id;
      resource.subject = { reference: patientRef };

      if (profile === "ips") {
        resource.meta = {
          profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/Condition-uv-ips"],
        };
      }

      entries.push({ fullUrl: `urn:uuid:${id}`, resource });
    } else {
      const id = generateUuid();
      const resource = buildCondition(resolved, id, patientRef, profile);
      entries.push({ fullUrl: `urn:uuid:${id}`, resource });
    }
  }

  return { entries, warnings };
}

async function resolveSingle(
  cond: ConditionOptions,
  warnings: ValidationIssue[],
): Promise<ResolvedCondition> {
  if ("byICD10" in cond && cond.byICD10 !== undefined) {
    return resolveICD10(cond as ConditionByICD10, warnings);
  }
  if ("bySNOMED" in cond && cond.bySNOMED !== undefined) {
    return resolveSNOMED(cond as ConditionBySNOMED, warnings);
  }
  if ("fromResource" in cond && cond.fromResource !== undefined) {
    return resolvePassthrough(cond as ConditionFromResource, warnings);
  }
  return resolveManual(cond as ConditionManual);
}

async function resolveICD10(
  cond: ConditionByICD10,
  warnings: ValidationIssue[],
): Promise<ResolvedCondition> {
  const codings: ResolvedCoding[] = [{ system: CODE_SYSTEMS.ICD10CM, code: cond.byICD10 }];
  let text: string | undefined;

  try {
    const result = await cond.fhirfly.icd10.lookup(cond.byICD10, { shape: "standard" });
    const data = result.data;

    codings[0]!.display = data.display;
    text = data.display;

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
      message: `ICD-10 lookup failed for "${cond.byICD10}" — included with bare code`,
      path: "Condition.code",
    });
  }

  return {
    codings,
    text,
    clinicalStatus: cond.clinicalStatus ?? "active",
    onsetDate: cond.onsetDate,
  };
}

async function resolveSNOMED(
  cond: ConditionBySNOMED,
  warnings: ValidationIssue[],
): Promise<ResolvedCondition> {
  let display = cond.display;

  if (cond.fhirfly) {
    try {
      const result = await cond.fhirfly.snomed.lookup(cond.bySNOMED);
      if (result.data.preferred_term) {
        display = result.data.preferred_term;
      }
    } catch {
      warnings.push({
        severity: "warning",
        message: `SNOMED lookup failed for "${cond.bySNOMED}" — using provided display`,
        path: "Condition.code",
      });
    }
  }

  if (!display) {
    warnings.push({
      severity: "warning",
      message: `No display name for SNOMED code "${cond.bySNOMED}"`,
      path: "Condition.code",
    });
  }

  return {
    codings: [{ system: CODE_SYSTEMS.SNOMED, code: cond.bySNOMED, display }],
    text: display,
    clinicalStatus: cond.clinicalStatus ?? "active",
    onsetDate: cond.onsetDate,
  };
}

function resolveManual(cond: ConditionManual): ResolvedCondition {
  return {
    codings: [{ system: cond.system, code: cond.code, display: cond.display }],
    text: cond.display,
    clinicalStatus: cond.clinicalStatus ?? "active",
    onsetDate: cond.onsetDate,
  };
}

async function resolvePassthrough(
  cond: ConditionFromResource,
  warnings: ValidationIssue[],
): Promise<ResolvedCondition> {
  const resource = cond.fromResource;

  validateConditionFromResource(resource);

  if (!resource.clinicalStatus) {
    warnings.push({
      severity: "warning",
      message: `fromResource missing "clinicalStatus" — will default to "active"`,
      path: "Condition.clinicalStatus",
    });
  }

  if (!resource.code) {
    warnings.push({
      severity: "warning",
      message: `fromResource missing "code"`,
      path: "Condition.code",
    });
  }

  // If fhirfly provided, try to enrich with SNOMED from existing ICD-10 codes
  if (cond.fhirfly && resource.code) {
    await enrichPassthroughWithSNOMED(resource, cond.fhirfly, warnings);
  }

  return {
    codings: [],
    clinicalStatus: "active",
    originalResource: resource,
  };
}

/** Throws if resourceType is not Condition. */
export function validateConditionFromResource(resource: Record<string, unknown>): void {
  const rt = resource.resourceType;
  if (rt !== "Condition") {
    throw new Error(
      `fromResource requires resourceType "Condition", got "${String(rt)}"`,
    );
  }
}

async function enrichPassthroughWithSNOMED(
  resource: Record<string, unknown>,
  fhirfly: FhirflyClient,
  warnings: ValidationIssue[],
): Promise<void> {
  const codeCC = resource.code as
    | { coding?: Array<{ system?: string; code?: string; display?: string }>; text?: string }
    | undefined;
  if (!codeCC?.coding) return;

  const hasSNOMED = codeCC.coding.some((c) => c.system === CODE_SYSTEMS.SNOMED);
  if (hasSNOMED) return;

  const icd10Coding = codeCC.coding.find((c) => c.system === CODE_SYSTEMS.ICD10CM);

  if (icd10Coding?.code) {
    try {
      const result = await fhirfly.icd10.lookup(icd10Coding.code, { shape: "standard" });
      if (result.data.snomed) {
        const newCodings: Array<{ system: string; code: string; display?: string }> = [];
        for (const s of result.data.snomed) {
          if (s.map_type && s.map_type.toLowerCase() !== "equivalent") continue;
          newCodings.push({ system: CODE_SYSTEMS.SNOMED, code: s.concept_id, display: s.display });
        }
        if (newCodings.length > 0) {
          codeCC.coding.push(...newCodings);
        }
      }
    } catch {
      warnings.push({
        severity: "warning",
        message: `ICD-10→SNOMED enrichment failed for "${icd10Coding.code}" on fromResource`,
        path: "Condition.code",
      });
    }
  }
}

/** Assemble a FHIR Condition resource from a resolved condition. */
function buildCondition(
  resolved: ResolvedCondition,
  id: string,
  patientRef: string,
  profile: "ips" | "r4",
): Record<string, unknown> {
  const resource: Record<string, unknown> = {
    resourceType: "Condition",
    id,
    clinicalStatus: {
      coding: [
        {
          system: CODE_SYSTEMS.CONDITION_CLINICAL,
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
    subject: { reference: patientRef },
  };

  if (profile === "ips") {
    resource.meta = {
      profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/Condition-uv-ips"],
    };
  }

  if (resolved.onsetDate) {
    resource.onsetDateTime = resolved.onsetDate;
  }

  return resource;
}
