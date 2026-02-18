// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import { describe, it, expect } from "vitest";
import { IPS } from "../src/index.js";

const PATIENT = { given: "Jane", family: "Doe", birthDate: "1990-01-15", gender: "female" as const };

// ---------------------------------------------------------------------------
// addDocument() — PDF
// ---------------------------------------------------------------------------

describe("addDocument — PDF", () => {
  it("wraps PDF as DocumentReference + Binary", async () => {
    const pdfContent = Buffer.from("fake PDF content");
    const bundle = new IPS.Bundle(PATIENT)
      .addDocument({ title: "Lab Report", content: pdfContent });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;

    const docRef = entries.find((e) => e.resource.resourceType === "DocumentReference");
    const binary = entries.find((e) => e.resource.resourceType === "Binary");

    expect(docRef).toBeDefined();
    expect(binary).toBeDefined();
  });

  it("sets default content type to application/pdf", async () => {
    const bundle = new IPS.Bundle(PATIENT)
      .addDocument({ title: "Report", content: Buffer.from("data") });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const binary = entries.find((e) => e.resource.resourceType === "Binary");

    expect(binary!.resource.contentType).toBe("application/pdf");
  });

  it("sets custom content type", async () => {
    const bundle = new IPS.Bundle(PATIENT)
      .addDocument({ title: "X-Ray", content: Buffer.from("data"), contentType: "image/tiff" });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const binary = entries.find((e) => e.resource.resourceType === "Binary");

    expect(binary!.resource.contentType).toBe("image/tiff");
  });

  it("base64-encodes the binary content", async () => {
    const content = Buffer.from("Hello, World!");
    const bundle = new IPS.Bundle(PATIENT)
      .addDocument({ title: "Test", content });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const binary = entries.find((e) => e.resource.resourceType === "Binary");

    expect(binary!.resource.data).toBe(content.toString("base64"));
  });

  it("supports Uint8Array content", async () => {
    const content = new Uint8Array([72, 101, 108, 108, 111]);
    const bundle = new IPS.Bundle(PATIENT)
      .addDocument({ title: "Test", content });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const binary = entries.find((e) => e.resource.resourceType === "Binary");

    expect(binary!.resource.data).toBe(Buffer.from(content).toString("base64"));
  });

  it("sets DocumentReference type with default LOINC code", async () => {
    const bundle = new IPS.Bundle(PATIENT)
      .addDocument({ title: "Summary", content: Buffer.from("data") });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const docRef = entries.find((e) => e.resource.resourceType === "DocumentReference");

    const type = docRef!.resource.type as { coding: Array<{ system: string; code: string; display: string }> };
    expect(type.coding[0]!.system).toBe("http://loinc.org");
    expect(type.coding[0]!.code).toBe("34133-9");
    expect(type.coding[0]!.display).toBe("Summarization of episode note");
  });

  it("supports custom LOINC type code", async () => {
    const bundle = new IPS.Bundle(PATIENT)
      .addDocument({
        title: "Lab Report",
        content: Buffer.from("data"),
        typeCode: "11502-2",
        typeDisplay: "Laboratory report",
      });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const docRef = entries.find((e) => e.resource.resourceType === "DocumentReference");

    const type = docRef!.resource.type as { coding: Array<{ code: string; display: string }> };
    expect(type.coding[0]!.code).toBe("11502-2");
    expect(type.coding[0]!.display).toBe("Laboratory report");
  });

  it("sets subject reference on DocumentReference", async () => {
    const bundle = new IPS.Bundle(PATIENT)
      .addDocument({ title: "Report", content: Buffer.from("data") });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const docRef = entries.find((e) => e.resource.resourceType === "DocumentReference");

    const subject = docRef!.resource.subject as { reference: string };
    expect(subject.reference).toMatch(/^urn:uuid:/);
  });

  it("links DocumentReference to Binary via attachment URL", async () => {
    const bundle = new IPS.Bundle(PATIENT)
      .addDocument({ title: "Report", content: Buffer.from("data") });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;
    const docRef = entries.find((e) => e.resource.resourceType === "DocumentReference");
    const binary = entries.find((e) => e.resource.resourceType === "Binary");

    const content = docRef!.resource.content as Array<{ attachment: { url: string } }>;
    expect(content[0]!.attachment.url).toBe(binary!.fullUrl);
  });

  it("sets IPS profile meta on DocumentReference", async () => {
    const bundle = new IPS.Bundle(PATIENT)
      .addDocument({ title: "Report", content: Buffer.from("data") });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const docRef = entries.find((e) => e.resource.resourceType === "DocumentReference");

    const meta = docRef!.resource.meta as { profile: string[] };
    expect(meta.profile).toContain(
      "http://hl7.org/fhir/uv/ips/StructureDefinition/DocumentReference-uv-ips",
    );
  });

  it("does not set IPS profile for r4 profile", async () => {
    const bundle = new IPS.Bundle(PATIENT)
      .addDocument({ title: "Report", content: Buffer.from("data") });

    const result = await bundle.build({ profile: "r4" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const docRef = entries.find((e) => e.resource.resourceType === "DocumentReference");

    expect(docRef!.resource.meta).toBeUndefined();
  });

  it("generates narrative on DocumentReference", async () => {
    const bundle = new IPS.Bundle(PATIENT)
      .addDocument({ title: "Lab Report", content: Buffer.from("data") });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const docRef = entries.find((e) => e.resource.resourceType === "DocumentReference");

    const text = docRef!.resource.text as { status: string; div: string };
    expect(text.status).toBe("generated");
    expect(text.div).toContain("Lab Report");
    expect(text.div).toContain("application/pdf");
  });

  it("sets custom date", async () => {
    const bundle = new IPS.Bundle(PATIENT)
      .addDocument({ title: "Report", content: Buffer.from("data"), date: "2026-01-15" });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const docRef = entries.find((e) => e.resource.resourceType === "DocumentReference");

    expect(docRef!.resource.date).toBe("2026-01-15");
  });
});

// ---------------------------------------------------------------------------
// Multiple documents
// ---------------------------------------------------------------------------

describe("Multiple documents", () => {
  it("builds multiple DocumentReference + Binary pairs", async () => {
    const bundle = new IPS.Bundle(PATIENT)
      .addDocument({ title: "Report 1", content: Buffer.from("data1") })
      .addDocument({ title: "Report 2", content: Buffer.from("data2"), contentType: "image/jpeg" });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;

    const docRefs = entries.filter((e) => e.resource.resourceType === "DocumentReference");
    const binaries = entries.filter((e) => e.resource.resourceType === "Binary");

    expect(docRefs).toHaveLength(2);
    expect(binaries).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Chaining
// ---------------------------------------------------------------------------

describe("Chaining — addDocument", () => {
  it("returns this for chaining", () => {
    const bundle = new IPS.Bundle(PATIENT);
    const returned = bundle.addDocument({ title: "Report", content: Buffer.from("data") });
    expect(returned).toBe(bundle);
  });

  it("chains with other resource types", async () => {
    const bundle = new IPS.Bundle(PATIENT)
      .addDocument({ title: "Report", content: Buffer.from("data") })
      .addCondition({ code: "E11.9", system: "http://hl7.org/fhir/sid/icd-10-cm", display: "Type 2 diabetes" });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;

    expect(entries.some((e) => e.resource.resourceType === "DocumentReference")).toBe(true);
    expect(entries.some((e) => e.resource.resourceType === "Binary")).toBe(true);
    expect(entries.some((e) => e.resource.resourceType === "Condition")).toBe(true);
  });
});
