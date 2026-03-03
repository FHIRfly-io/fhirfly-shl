// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import { describe, it, expect } from "vitest";
import { IPS } from "../src/index.js";
import { CODE_SYSTEMS } from "../src/ips/code-systems.js";

const minimalPatient = {
  given: "Jane",
  family: "Doe",
  birthDate: "1990-01-15",
  gender: "female" as const,
};

const pdfContent = Buffer.from("%PDF-1.4 test content");

describe("IPS PSHD bundle — bundle structure", () => {
  it("produces a collection bundle (not document)", async () => {
    const bundle = new IPS.Bundle(minimalPatient);
    bundle.addDocument({ title: "Patient Summary", content: pdfContent });
    const result = await bundle.build({ profile: "pshd" });
    expect(result.type).toBe("collection");
  });

  it("has no Composition resource", async () => {
    const bundle = new IPS.Bundle(minimalPatient);
    bundle.addDocument({ title: "Patient Summary", content: pdfContent });
    const result = await bundle.build({ profile: "pshd" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const composition = entries.find((e) => e.resource.resourceType === "Composition");
    expect(composition).toBeUndefined();
  });

  it("Patient is the first entry", async () => {
    const bundle = new IPS.Bundle(minimalPatient);
    bundle.addMedication({
      code: "860975",
      system: CODE_SYSTEMS.RXNORM,
      display: "Metformin",
      status: "active",
    });
    bundle.addDocument({ title: "Patient Summary", content: pdfContent });
    const result = await bundle.build({ profile: "pshd" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    expect(entries[0]!.resource.resourceType).toBe("Patient");
  });

  it("has timestamp set", async () => {
    const bundle = new IPS.Bundle(minimalPatient);
    bundle.addDocument({ title: "Patient Summary", content: pdfContent });
    const result = await bundle.build({ profile: "pshd" });
    expect(result.timestamp).toBeDefined();
  });

  it("has identifier with urn:uuid system", async () => {
    const bundle = new IPS.Bundle(minimalPatient);
    bundle.addDocument({ title: "Patient Summary", content: pdfContent });
    const result = await bundle.build({ profile: "pshd" });
    const identifier = result.identifier as { system: string; value: string };
    expect(identifier.system).toBe("urn:ietf:rfc:3986");
    expect(identifier.value).toMatch(/^urn:uuid:/);
  });

  it("Patient has no meta.profile (PSHD strips it)", async () => {
    const bundle = new IPS.Bundle(minimalPatient);
    bundle.addDocument({ title: "Patient Summary", content: pdfContent });
    const result = await bundle.build({ profile: "pshd" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const patient = entries.find((e) => e.resource.resourceType === "Patient")!;
    expect(patient.resource.meta).toBeUndefined();
  });
});

describe("IPS PSHD bundle — DocumentReference constraints", () => {
  it("DocumentReference type is 60591-5 (Patient summary Document)", async () => {
    const bundle = new IPS.Bundle(minimalPatient);
    bundle.addDocument({ title: "Patient Summary", content: pdfContent });
    const result = await bundle.build({ profile: "pshd" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const docRef = entries.find((e) => e.resource.resourceType === "DocumentReference")!;
    const type = docRef.resource.type as { coding: Array<{ code: string; display: string }> };
    expect(type.coding[0]!.code).toBe("60591-5");
    expect(type.coding[0]!.display).toBe("Patient summary Document");
  });

  it("DocumentReference has CMS patient-shared category", async () => {
    const bundle = new IPS.Bundle(minimalPatient);
    bundle.addDocument({ title: "Patient Summary", content: pdfContent });
    const result = await bundle.build({ profile: "pshd" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const docRef = entries.find((e) => e.resource.resourceType === "DocumentReference")!;
    const category = docRef.resource.category as Array<{ coding: Array<{ system: string; code: string }> }>;
    expect(category).toBeDefined();
    expect(category[0]!.coding[0]!.system).toBe(CODE_SYSTEMS.CMS_PATIENT_SHARED_CATEGORY);
    expect(category[0]!.coding[0]!.code).toBe("patient-shared");
  });

  it("DocumentReference author references Patient (not SDK)", async () => {
    const bundle = new IPS.Bundle(minimalPatient);
    bundle.addDocument({ title: "Patient Summary", content: pdfContent });
    const result = await bundle.build({ profile: "pshd" });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;
    const patient = entries.find((e) => e.resource.resourceType === "Patient")!;
    const docRef = entries.find((e) => e.resource.resourceType === "DocumentReference")!;
    const author = docRef.resource.author as Array<{ reference: string }>;
    expect(author[0]!.reference).toBe(patient.fullUrl);
  });

  it("DocumentReference has PATAST security label", async () => {
    const bundle = new IPS.Bundle(minimalPatient);
    bundle.addDocument({ title: "Patient Summary", content: pdfContent });
    const result = await bundle.build({ profile: "pshd" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const docRef = entries.find((e) => e.resource.resourceType === "DocumentReference")!;
    const meta = docRef.resource.meta as { security: Array<{ code: string }> };
    expect(meta.security[0]!.code).toBe("PATAST");
  });

  it("DocumentReference has no meta.profile (PSHD strips IPS profile)", async () => {
    const bundle = new IPS.Bundle(minimalPatient);
    bundle.addDocument({ title: "Patient Summary", content: pdfContent });
    const result = await bundle.build({ profile: "pshd" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const docRef = entries.find((e) => e.resource.resourceType === "DocumentReference")!;
    const meta = docRef.resource.meta as Record<string, unknown> | undefined;
    if (meta) {
      expect(meta.profile).toBeUndefined();
    }
  });
});

describe("IPS PSHD bundle — meta.profile stripping", () => {
  it("no resource in PSHD bundle has meta.profile", async () => {
    const bundle = new IPS.Bundle(minimalPatient);
    bundle.addMedication({
      code: "860975",
      system: CODE_SYSTEMS.RXNORM,
      display: "Metformin",
      status: "active",
    });
    bundle.addCondition({
      code: "E11.9",
      system: CODE_SYSTEMS.ICD10CM,
      display: "Type 2 diabetes",
    });
    bundle.addAllergy({
      code: "387207008",
      system: CODE_SYSTEMS.SNOMED,
      display: "Ibuprofen",
    });
    bundle.addDocument({ title: "Summary", content: pdfContent });
    const result = await bundle.build({ profile: "pshd" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;

    for (const entry of entries) {
      const meta = entry.resource.meta as Record<string, unknown> | undefined;
      if (meta) {
        expect(meta.profile).toBeUndefined();
      }
    }
  });

  it("meta.profile is still present in IPS mode", async () => {
    const bundle = new IPS.Bundle(minimalPatient);
    bundle.addMedication({
      code: "860975",
      system: CODE_SYSTEMS.RXNORM,
      display: "Metformin",
      status: "active",
    });
    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const composition = entries.find((e) => e.resource.resourceType === "Composition")!;
    const meta = composition.resource.meta as Record<string, unknown> | undefined;
    expect(meta?.profile).toBeDefined();
  });
});

describe("IPS PSHD bundle — validation", () => {
  it("error when no documents added", () => {
    const bundle = new IPS.Bundle(minimalPatient);
    const validation = bundle.validate({ profile: "pshd" });
    expect(validation.valid).toBe(false);
    expect(validation.issues.some((i) => i.severity === "error" && i.message.includes("DocumentReference"))).toBe(true);
  });

  it("error when no PDF document", () => {
    const bundle = new IPS.Bundle(minimalPatient);
    bundle.addDocument({ title: "Summary", content: pdfContent, contentType: "image/tiff" });
    const validation = bundle.validate({ profile: "pshd" });
    expect(validation.valid).toBe(false);
    expect(validation.issues.some((i) => i.severity === "error" && i.message.includes("PDF"))).toBe(true);
  });

  it("warning when patient missing gender", () => {
    const noGender = { given: "Jane", family: "Doe", birthDate: "1990-01-15" };
    const bundle = new IPS.Bundle(noGender);
    bundle.addDocument({ title: "Summary", content: pdfContent });
    const validation = bundle.validate({ profile: "pshd" });
    expect(validation.issues.some((i) => i.severity === "warning" && i.message.includes("gender"))).toBe(true);
  });

  it("valid when PDF document present", () => {
    const bundle = new IPS.Bundle(minimalPatient);
    bundle.addDocument({ title: "Summary", content: pdfContent });
    const validation = bundle.validate({ profile: "pshd" });
    expect(validation.valid).toBe(true);
  });

  it("valid with default contentType (application/pdf)", () => {
    const bundle = new IPS.Bundle(minimalPatient);
    // No contentType specified → defaults to application/pdf
    bundle.addDocument({ title: "Summary", content: pdfContent });
    const validation = bundle.validate({ profile: "pshd" });
    expect(validation.valid).toBe(true);
  });
});
