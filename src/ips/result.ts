// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
/**
 * Internal result resolution — converts result input variants
 * into resolved results and then into FHIR Observation resources.
 */

import { CODE_SYSTEMS } from "./code-systems.js";
import { resultNarrative } from "./narrative.js";
import type {
  ResultOptions,
  ResultByLOINC,
  ResultFromResource,
  ResultManual,
  ResolvedResult,
  ResolvedCoding,
  ValidationIssue,
} from "./types.js";

/** Result of resolving all results — includes build-time warnings. */
export interface ResultResolutionResult {
  entries: Array<{ fullUrl: string; resource: Record<string, unknown> }>;
  warnings: ValidationIssue[];
}

/**
 * Resolve all result inputs into FHIR Observation Bundle entries.
 */
export async function resolveResults(
  results: ResultOptions[],
  patientRef: string,
  profile: "ips" | "r4",
  generateUuid: () => string,
): Promise<ResultResolutionResult> {
  const entries: Array<{ fullUrl: string; resource: Record<string, unknown> }> = [];
  const warnings: ValidationIssue[] = [];

  for (const result of results) {
    const resolved = await resolveSingle(result, warnings);

    if (resolved.originalResource) {
      const id = generateUuid();
      const resource = { ...resolved.originalResource };
      resource.id = id;
      resource.subject = { reference: patientRef };

      if (profile === "ips") {
        resource.meta = {
          profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/Observation-results-laboratory-uv-ips"],
        };
      }

      entries.push({ fullUrl: `urn:uuid:${id}`, resource });
    } else {
      const id = generateUuid();
      const resource = buildObservation(resolved, id, patientRef, profile);
      entries.push({ fullUrl: `urn:uuid:${id}`, resource });
    }
  }

  return { entries, warnings };
}

async function resolveSingle(
  result: ResultOptions,
  warnings: ValidationIssue[],
): Promise<ResolvedResult> {
  if ("byLOINC" in result && result.byLOINC !== undefined) {
    return resolveLOINC(result as ResultByLOINC, warnings);
  }
  if ("fromResource" in result && result.fromResource !== undefined) {
    return resolvePassthrough(result as ResultFromResource, warnings);
  }
  return resolveManual(result as ResultManual);
}

async function resolveLOINC(
  result: ResultByLOINC,
  warnings: ValidationIssue[],
): Promise<ResolvedResult> {
  const codings: ResolvedCoding[] = [{ system: CODE_SYSTEMS.LOINC, code: result.byLOINC }];
  let text: string | undefined;

  try {
    const apiResult = await result.fhirfly.loinc.lookup(result.byLOINC, { shape: "standard" });
    const data = apiResult.data;

    codings[0]!.display = data.long_common_name;
    text = data.long_common_name;
  } catch {
    warnings.push({
      severity: "warning",
      message: `LOINC lookup failed for "${result.byLOINC}" — included with bare code`,
      path: "Observation.code",
    });
  }

  return {
    codings,
    text,
    status: result.status ?? "final",
    value: result.value,
    valueString: result.valueString,
    unit: result.unit,
    unitCode: result.unitCode,
    referenceRange: result.referenceRange,
    effectiveDate: result.effectiveDate,
  };
}

function resolveManual(result: ResultManual): ResolvedResult {
  return {
    codings: [{ system: result.system, code: result.code, display: result.display }],
    text: result.display,
    status: result.status ?? "final",
    value: result.value,
    valueString: result.valueString,
    unit: result.unit,
    unitCode: result.unitCode,
    referenceRange: result.referenceRange,
    effectiveDate: result.effectiveDate,
  };
}

async function resolvePassthrough(
  result: ResultFromResource,
  warnings: ValidationIssue[],
): Promise<ResolvedResult> {
  const resource = result.fromResource;

  validateResultFromResource(resource);

  if (!resource.status) {
    warnings.push({
      severity: "warning",
      message: `fromResource missing "status" — will default to "final"`,
      path: "Observation.status",
    });
  }

  if (!resource.code) {
    warnings.push({
      severity: "warning",
      message: `fromResource missing "code"`,
      path: "Observation.code",
    });
  }

  return {
    codings: [],
    status: "final",
    originalResource: resource,
  };
}

/** Throws if resourceType is not Observation. */
export function validateResultFromResource(resource: Record<string, unknown>): void {
  const rt = resource.resourceType;
  if (rt !== "Observation") {
    throw new Error(
      `fromResource requires resourceType "Observation", got "${String(rt)}"`,
    );
  }
}

/** Assemble a FHIR Observation resource from a resolved result. */
function buildObservation(
  resolved: ResolvedResult,
  id: string,
  patientRef: string,
  profile: "ips" | "r4",
): Record<string, unknown> {
  const resource: Record<string, unknown> = {
    resourceType: "Observation",
    id,
    status: resolved.status,
    category: [
      {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/observation-category",
            code: "laboratory",
            display: "Laboratory",
          },
        ],
      },
    ],
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
      profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/Observation-results-laboratory-uv-ips"],
    };
  }

  // Value — numeric or string
  if (resolved.value !== undefined && resolved.unit) {
    resource.valueQuantity = {
      value: resolved.value,
      unit: resolved.unit,
      system: "http://unitsofmeasure.org",
      code: resolved.unitCode ?? resolved.unit,
    };
  } else if (resolved.valueString !== undefined) {
    resource.valueString = resolved.valueString;
  }

  // Reference range
  if (resolved.referenceRange) {
    const range: Record<string, unknown> = {};
    const rangeUnit = resolved.referenceRange.unit ?? resolved.unit;
    if (resolved.referenceRange.low !== undefined) {
      range.low = {
        value: resolved.referenceRange.low,
        ...(rangeUnit ? { unit: rangeUnit, system: "http://unitsofmeasure.org", code: rangeUnit } : {}),
      };
    }
    if (resolved.referenceRange.high !== undefined) {
      range.high = {
        value: resolved.referenceRange.high,
        ...(rangeUnit ? { unit: rangeUnit, system: "http://unitsofmeasure.org", code: rangeUnit } : {}),
      };
    }
    resource.referenceRange = [range];
  }

  // Effective date
  if (resolved.effectiveDate) {
    resource.effectiveDateTime = resolved.effectiveDate;
  }

  resource.text = {
    status: "generated",
    div: resultNarrative(
      resolved.text,
      resolved.value,
      resolved.valueString,
      resolved.unit,
      resolved.effectiveDate,
    ),
  };

  return resource;
}
