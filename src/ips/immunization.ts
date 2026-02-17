// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
/**
 * Internal immunization resolution — converts immunization input variants
 * into resolved immunizations and then into FHIR Immunization resources.
 */

import { CODE_SYSTEMS } from "./code-systems.js";
import { immunizationNarrative } from "./narrative.js";
import type {
  ImmunizationOptions,
  ImmunizationByCVX,
  ImmunizationFromResource,
  ImmunizationManual,
  ResolvedImmunization,
  ResolvedCoding,
  ValidationIssue,
} from "./types.js";

/** Result of resolving all immunizations — includes build-time warnings. */
export interface ImmunizationResolutionResult {
  entries: Array<{ fullUrl: string; resource: Record<string, unknown> }>;
  warnings: ValidationIssue[];
}

/**
 * Resolve all immunization inputs into FHIR Immunization Bundle entries.
 */
export async function resolveImmunizations(
  immunizations: ImmunizationOptions[],
  patientRef: string,
  profile: "ips" | "r4",
  generateUuid: () => string,
): Promise<ImmunizationResolutionResult> {
  const entries: Array<{ fullUrl: string; resource: Record<string, unknown> }> = [];
  const warnings: ValidationIssue[] = [];

  for (const imm of immunizations) {
    const resolved = await resolveSingle(imm, warnings);

    if (resolved.originalResource) {
      const id = generateUuid();
      const resource = { ...resolved.originalResource };
      resource.id = id;
      resource.patient = { reference: patientRef };

      if (profile === "ips") {
        resource.meta = {
          profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/Immunization-uv-ips"],
        };
      }

      entries.push({ fullUrl: `urn:uuid:${id}`, resource });
    } else {
      const id = generateUuid();
      const resource = buildImmunization(resolved, id, patientRef, profile);
      entries.push({ fullUrl: `urn:uuid:${id}`, resource });
    }
  }

  return { entries, warnings };
}

async function resolveSingle(
  imm: ImmunizationOptions,
  warnings: ValidationIssue[],
): Promise<ResolvedImmunization> {
  if ("byCVX" in imm && imm.byCVX !== undefined) {
    return resolveCVX(imm as ImmunizationByCVX, warnings);
  }
  if ("fromResource" in imm && imm.fromResource !== undefined) {
    return resolvePassthrough(imm as ImmunizationFromResource, warnings);
  }
  return resolveManual(imm as ImmunizationManual);
}

async function resolveCVX(
  imm: ImmunizationByCVX,
  warnings: ValidationIssue[],
): Promise<ResolvedImmunization> {
  const codings: ResolvedCoding[] = [{ system: CODE_SYSTEMS.CVX, code: imm.byCVX }];
  let text: string | undefined;

  try {
    const result = await imm.fhirfly.cvx.lookup(imm.byCVX);
    const data = result.data;

    codings[0]!.display = data.display;
    text = data.display;
  } catch {
    warnings.push({
      severity: "warning",
      message: `CVX lookup failed for "${imm.byCVX}" — included with bare code`,
      path: "Immunization.vaccineCode",
    });
  }

  return {
    codings,
    text,
    status: imm.status ?? "completed",
    occurrenceDate: imm.occurrenceDate,
  };
}

function resolveManual(imm: ImmunizationManual): ResolvedImmunization {
  return {
    codings: [{ system: imm.system, code: imm.code, display: imm.display }],
    text: imm.display,
    status: imm.status ?? "completed",
    occurrenceDate: imm.occurrenceDate,
  };
}

async function resolvePassthrough(
  imm: ImmunizationFromResource,
  warnings: ValidationIssue[],
): Promise<ResolvedImmunization> {
  const resource = imm.fromResource;

  validateImmunizationFromResource(resource);

  if (!resource.status) {
    warnings.push({
      severity: "warning",
      message: `fromResource missing "status" — will default to "completed"`,
      path: "Immunization.status",
    });
  }

  if (!resource.vaccineCode) {
    warnings.push({
      severity: "warning",
      message: `fromResource missing "vaccineCode"`,
      path: "Immunization.vaccineCode",
    });
  }

  return {
    codings: [],
    status: "completed",
    originalResource: resource,
  };
}

/** Throws if resourceType is not Immunization. */
export function validateImmunizationFromResource(resource: Record<string, unknown>): void {
  const rt = resource.resourceType;
  if (rt !== "Immunization") {
    throw new Error(
      `fromResource requires resourceType "Immunization", got "${String(rt)}"`,
    );
  }
}

/** Assemble a FHIR Immunization resource from a resolved immunization. */
function buildImmunization(
  resolved: ResolvedImmunization,
  id: string,
  patientRef: string,
  profile: "ips" | "r4",
): Record<string, unknown> {
  const resource: Record<string, unknown> = {
    resourceType: "Immunization",
    id,
    status: resolved.status,
    vaccineCode: {
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
      profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/Immunization-uv-ips"],
    };
  }

  if (resolved.occurrenceDate) {
    resource.occurrenceDateTime = resolved.occurrenceDate;
  }

  resource.text = {
    status: "generated",
    div: immunizationNarrative(resolved.text, resolved.status, resolved.occurrenceDate),
  };

  return resource;
}
