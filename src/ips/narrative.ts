// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
const XHTML_NS = "http://www.w3.org/1999/xhtml";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function wrap(lines: string[]): string {
  const body = lines.join("");
  return `<div xmlns="${XHTML_NS}">${body}</div>`;
}

export function medicationNarrative(
  displayText: string | undefined,
  dosageText: string | undefined,
  effectiveDate: string | undefined,
): string {
  const lines: string[] = [];
  lines.push(`<p><b>${esc(displayText ?? "Medication")}</b></p>`);
  if (dosageText) lines.push(`<p>Dosage: ${esc(dosageText)}</p>`);
  if (effectiveDate) lines.push(`<p>Effective: ${esc(effectiveDate)}</p>`);
  return wrap(lines);
}

export function conditionNarrative(
  displayText: string | undefined,
  clinicalStatus: string,
  onsetDate: string | undefined,
): string {
  const lines: string[] = [];
  lines.push(`<p><b>${esc(displayText ?? "Condition")}</b></p>`);
  lines.push(`<p>Clinical Status: ${esc(clinicalStatus)}</p>`);
  if (onsetDate) lines.push(`<p>Onset: ${esc(onsetDate)}</p>`);
  return wrap(lines);
}

export function allergyNarrative(
  displayText: string | undefined,
  clinicalStatus: string,
  criticality: string | undefined,
): string {
  const lines: string[] = [];
  lines.push(`<p><b>${esc(displayText ?? "Allergy")}</b></p>`);
  lines.push(`<p>Clinical Status: ${esc(clinicalStatus)}</p>`);
  if (criticality) lines.push(`<p>Criticality: ${esc(criticality)}</p>`);
  return wrap(lines);
}

export function immunizationNarrative(
  displayText: string | undefined,
  status: string,
  occurrenceDate: string | undefined,
): string {
  const lines: string[] = [];
  lines.push(`<p><b>${esc(displayText ?? "Immunization")}</b></p>`);
  lines.push(`<p>Status: ${esc(status)}</p>`);
  if (occurrenceDate) lines.push(`<p>Date: ${esc(occurrenceDate)}</p>`);
  return wrap(lines);
}

export function patientNarrative(
  name: string | undefined,
  birthDate: string,
  gender: string | undefined,
): string {
  const lines: string[] = [];
  lines.push(`<p><b>${esc(name ?? "Patient")}</b></p>`);
  lines.push(`<p>DOB: ${esc(birthDate)}</p>`);
  if (gender) lines.push(`<p>Gender: ${esc(gender)}</p>`);
  return wrap(lines);
}
