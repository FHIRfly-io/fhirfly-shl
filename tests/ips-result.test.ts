// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import { describe, it, expect, vi } from "vitest";
import { IPS } from "../src/index.js";

// ---------------------------------------------------------------------------
// Mock FhirflyClient
// ---------------------------------------------------------------------------

function mockFhirfly(overrides?: Partial<IPS.FhirflyClient>): IPS.FhirflyClient {
  return {
    ndc: { lookup: vi.fn() },
    rxnorm: { lookup: vi.fn() },
    snomed: { lookup: vi.fn() },
    icd10: { lookup: vi.fn() },
    cvx: { lookup: vi.fn() },
    loinc: {
      lookup: vi.fn().mockResolvedValue({
        data: {
          loinc_num: "2345-7",
          component: "Glucose",
          long_common_name: "Glucose [Mass/volume] in Serum or Plasma",
          class: "CHEM",
          system: "Ser/Plas",
          scale_typ: "Qn",
        },
      }),
      ...overrides?.loinc,
    },
    ...overrides,
  } as IPS.FhirflyClient;
}

function failingFhirfly(): IPS.FhirflyClient {
  return {
    ndc: { lookup: vi.fn() },
    rxnorm: { lookup: vi.fn() },
    snomed: { lookup: vi.fn() },
    icd10: { lookup: vi.fn() },
    cvx: { lookup: vi.fn() },
    loinc: {
      lookup: vi.fn().mockRejectedValue(new Error("API unavailable")),
    },
  } as IPS.FhirflyClient;
}

const PATIENT = { given: "Jane", family: "Doe", birthDate: "1990-01-15", gender: "female" as const };

// ---------------------------------------------------------------------------
// addResult() — byLOINC
// ---------------------------------------------------------------------------

describe("addResult — byLOINC", () => {
  it("builds Observation with LOINC coding from API enrichment", async () => {
    const fhirfly = mockFhirfly();
    const bundle = new IPS.Bundle(PATIENT)
      .addResult({
        byLOINC: "2345-7",
        fhirfly,
        value: 95,
        unit: "mg/dL",
        effectiveDate: "2026-01-15",
      });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const obs = entries.find((e) => e.resource.resourceType === "Observation");

    expect(obs).toBeDefined();
    expect(obs!.resource.status).toBe("final");

    const code = obs!.resource.code as { coding: Array<{ system: string; code: string; display?: string }> };
    expect(code.coding[0]!.system).toBe("http://loinc.org");
    expect(code.coding[0]!.code).toBe("2345-7");
    expect(code.coding[0]!.display).toBe("Glucose [Mass/volume] in Serum or Plasma");

    const valueQuantity = obs!.resource.valueQuantity as { value: number; unit: string };
    expect(valueQuantity.value).toBe(95);
    expect(valueQuantity.unit).toBe("mg/dL");

    expect(obs!.resource.effectiveDateTime).toBe("2026-01-15");
  });

  it("includes IPS profile meta", async () => {
    const fhirfly = mockFhirfly();
    const bundle = new IPS.Bundle(PATIENT)
      .addResult({ byLOINC: "2345-7", fhirfly, value: 95, unit: "mg/dL" });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const obs = entries.find((e) => e.resource.resourceType === "Observation");

    const meta = obs!.resource.meta as { profile: string[] };
    expect(meta.profile).toContain(
      "http://hl7.org/fhir/uv/ips/StructureDefinition/Observation-results-laboratory-uv-ips",
    );
  });

  it("sets laboratory category", async () => {
    const fhirfly = mockFhirfly();
    const bundle = new IPS.Bundle(PATIENT)
      .addResult({ byLOINC: "2345-7", fhirfly, value: 95, unit: "mg/dL" });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const obs = entries.find((e) => e.resource.resourceType === "Observation");

    const category = obs!.resource.category as Array<{ coding: Array<{ code: string }> }>;
    expect(category[0]!.coding[0]!.code).toBe("laboratory");
  });

  it("supports custom status", async () => {
    const fhirfly = mockFhirfly();
    const bundle = new IPS.Bundle(PATIENT)
      .addResult({ byLOINC: "2345-7", fhirfly, value: 95, unit: "mg/dL", status: "preliminary" });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const obs = entries.find((e) => e.resource.resourceType === "Observation");

    expect(obs!.resource.status).toBe("preliminary");
  });

  it("supports reference range", async () => {
    const fhirfly = mockFhirfly();
    const bundle = new IPS.Bundle(PATIENT)
      .addResult({
        byLOINC: "2345-7",
        fhirfly,
        value: 95,
        unit: "mg/dL",
        referenceRange: { low: 70, high: 110 },
      });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const obs = entries.find((e) => e.resource.resourceType === "Observation");

    const refRange = obs!.resource.referenceRange as Array<{
      low: { value: number; unit: string };
      high: { value: number; unit: string };
    }>;
    expect(refRange[0]!.low.value).toBe(70);
    expect(refRange[0]!.high.value).toBe(110);
    expect(refRange[0]!.low.unit).toBe("mg/dL");
  });

  it("supports string values", async () => {
    const fhirfly = mockFhirfly();
    const bundle = new IPS.Bundle(PATIENT)
      .addResult({
        byLOINC: "5778-6",
        fhirfly,
        valueString: "Positive",
      });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const obs = entries.find((e) => e.resource.resourceType === "Observation");

    expect(obs!.resource.valueString).toBe("Positive");
    expect(obs!.resource.valueQuantity).toBeUndefined();
  });

  it("degrades gracefully on API failure", async () => {
    const fhirfly = failingFhirfly();
    const bundle = new IPS.Bundle(PATIENT)
      .addResult({ byLOINC: "2345-7", fhirfly, value: 95, unit: "mg/dL" });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const obs = entries.find((e) => e.resource.resourceType === "Observation");

    // Still includes bare code
    const code = obs!.resource.code as { coding: Array<{ system: string; code: string; display?: string }> };
    expect(code.coding[0]!.code).toBe("2345-7");
    expect(code.coding[0]!.display).toBeUndefined();

    // Warning generated
    expect(bundle.warnings.some((w) => w.message.includes("LOINC lookup failed"))).toBe(true);
  });

  it("supports unitCode different from unit", async () => {
    const fhirfly = mockFhirfly();
    const bundle = new IPS.Bundle(PATIENT)
      .addResult({
        byLOINC: "2345-7",
        fhirfly,
        value: 5.3,
        unit: "mmol/L",
        unitCode: "mmol/L",
      });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const obs = entries.find((e) => e.resource.resourceType === "Observation");

    const vq = obs!.resource.valueQuantity as { value: number; unit: string; code: string; system: string };
    expect(vq.value).toBe(5.3);
    expect(vq.unit).toBe("mmol/L");
    expect(vq.code).toBe("mmol/L");
    expect(vq.system).toBe("http://unitsofmeasure.org");
  });
});

// ---------------------------------------------------------------------------
// addResult() — manual
// ---------------------------------------------------------------------------

describe("addResult — manual", () => {
  it("builds Observation with manual coding", async () => {
    const bundle = new IPS.Bundle(PATIENT)
      .addResult({
        code: "2345-7",
        system: "http://loinc.org",
        display: "Glucose",
        value: 95,
        unit: "mg/dL",
        effectiveDate: "2026-01-15",
      });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const obs = entries.find((e) => e.resource.resourceType === "Observation");

    expect(obs).toBeDefined();
    const code = obs!.resource.code as { coding: Array<{ display: string }>; text: string };
    expect(code.coding[0]!.display).toBe("Glucose");
    expect(code.text).toBe("Glucose");
  });

  it("defaults status to final", async () => {
    const bundle = new IPS.Bundle(PATIENT)
      .addResult({ code: "2345-7", system: "http://loinc.org", display: "Glucose" });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const obs = entries.find((e) => e.resource.resourceType === "Observation");

    expect(obs!.resource.status).toBe("final");
  });
});

// ---------------------------------------------------------------------------
// addResult() — fromResource
// ---------------------------------------------------------------------------

describe("addResult — fromResource", () => {
  it("passes through an existing Observation resource", async () => {
    const existingObs = {
      resourceType: "Observation",
      status: "final",
      code: {
        coding: [{ system: "http://loinc.org", code: "2345-7", display: "Glucose" }],
      },
      valueQuantity: { value: 95, unit: "mg/dL" },
    };

    const bundle = new IPS.Bundle(PATIENT)
      .addResult({ fromResource: existingObs });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const obs = entries.find((e) => e.resource.resourceType === "Observation");

    expect(obs).toBeDefined();
    expect(obs!.resource.status).toBe("final");
    expect((obs!.resource.valueQuantity as { value: number }).value).toBe(95);
  });

  it("throws for wrong resourceType", () => {
    expect(() => {
      new IPS.Bundle(PATIENT).addResult({
        fromResource: { resourceType: "Condition" },
      });
    }).toThrow('fromResource requires resourceType "Observation"');
  });

  it("warns on missing status", () => {
    const bundle = new IPS.Bundle(PATIENT)
      .addResult({ fromResource: { resourceType: "Observation" } });

    expect(bundle.warnings.some((w) => w.message.includes('missing "status"'))).toBe(true);
  });

  it("warns on missing code", () => {
    const bundle = new IPS.Bundle(PATIENT)
      .addResult({ fromResource: { resourceType: "Observation", status: "final" } });

    expect(bundle.warnings.some((w) => w.message.includes('missing "code"'))).toBe(true);
  });

  it("sets IPS profile on passthrough resource", async () => {
    const bundle = new IPS.Bundle(PATIENT)
      .addResult({
        fromResource: {
          resourceType: "Observation",
          status: "final",
          code: { coding: [{ system: "http://loinc.org", code: "2345-7" }] },
        },
      });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const obs = entries.find((e) => e.resource.resourceType === "Observation");

    const meta = obs!.resource.meta as { profile: string[] };
    expect(meta.profile).toContain(
      "http://hl7.org/fhir/uv/ips/StructureDefinition/Observation-results-laboratory-uv-ips",
    );
  });
});

// ---------------------------------------------------------------------------
// Composition — Results section
// ---------------------------------------------------------------------------

describe("Composition — Results section", () => {
  it("includes Results section when results are present", async () => {
    const fhirfly = mockFhirfly();
    const bundle = new IPS.Bundle(PATIENT)
      .addResult({ byLOINC: "2345-7", fhirfly, value: 95, unit: "mg/dL" });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const comp = entries.find((e) => e.resource.resourceType === "Composition");

    const sections = comp!.resource.section as Array<{ title: string; code: { coding: Array<{ code: string }> } }>;
    const resultSection = sections.find((s) => s.title === "Results");

    expect(resultSection).toBeDefined();
    expect(resultSection!.code.coding[0]!.code).toBe("30954-2");
  });

  it("omits Results section when no results", async () => {
    const bundle = new IPS.Bundle(PATIENT);
    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const comp = entries.find((e) => e.resource.resourceType === "Composition");

    const sections = comp!.resource.section as Array<{ title: string }>;
    const resultSection = sections.find((s) => s.title === "Results");

    expect(resultSection).toBeUndefined();
  });

  it("Results section has entry references", async () => {
    const fhirfly = mockFhirfly();
    const bundle = new IPS.Bundle(PATIENT)
      .addResult({ byLOINC: "2345-7", fhirfly, value: 95, unit: "mg/dL" })
      .addResult({ byLOINC: "789-8", fhirfly, value: 4.5, unit: "10*6/uL" });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const comp = entries.find((e) => e.resource.resourceType === "Composition");

    const sections = comp!.resource.section as Array<{ title: string; entry?: Array<{ reference: string }> }>;
    const resultSection = sections.find((s) => s.title === "Results");

    expect(resultSection!.entry).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Narrative
// ---------------------------------------------------------------------------

describe("Result narrative", () => {
  it("generates text.div with value and unit", async () => {
    const fhirfly = mockFhirfly();
    const bundle = new IPS.Bundle(PATIENT)
      .addResult({ byLOINC: "2345-7", fhirfly, value: 95, unit: "mg/dL" });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const obs = entries.find((e) => e.resource.resourceType === "Observation");

    const text = obs!.resource.text as { status: string; div: string };
    expect(text.status).toBe("generated");
    expect(text.div).toContain("95");
    expect(text.div).toContain("mg/dL");
  });
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("Validation — results", () => {
  it("reports information when result has no effectiveDate", () => {
    const fhirfly = mockFhirfly();
    const bundle = new IPS.Bundle(PATIENT)
      .addResult({ byLOINC: "2345-7", fhirfly, value: 95, unit: "mg/dL" });

    const validation = bundle.validate({ profile: "ips" });
    expect(validation.issues.some((i) => i.message.includes("Result has no effectiveDate"))).toBe(true);
  });

  it("does not report information when effectiveDate is set", () => {
    const fhirfly = mockFhirfly();
    const bundle = new IPS.Bundle(PATIENT)
      .addResult({ byLOINC: "2345-7", fhirfly, value: 95, unit: "mg/dL", effectiveDate: "2026-01-15" });

    const validation = bundle.validate({ profile: "ips" });
    expect(validation.issues.some((i) => i.message.includes("Result has no effectiveDate"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Multiple results
// ---------------------------------------------------------------------------

describe("Multiple results", () => {
  it("builds multiple Observation resources", async () => {
    const fhirfly = mockFhirfly();
    const bundle = new IPS.Bundle(PATIENT)
      .addResult({ byLOINC: "2345-7", fhirfly, value: 95, unit: "mg/dL" })
      .addResult({
        code: "789-8",
        system: "http://loinc.org",
        display: "Erythrocytes [#/volume] in Blood",
        value: 4.5,
        unit: "10*6/uL",
      });

    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ resource: Record<string, unknown> }>;
    const observations = entries.filter((e) => e.resource.resourceType === "Observation");

    expect(observations).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Chaining
// ---------------------------------------------------------------------------

describe("Chaining", () => {
  it("addResult returns this for chaining", () => {
    const fhirfly = mockFhirfly();
    const bundle = new IPS.Bundle(PATIENT);
    const returned = bundle.addResult({ byLOINC: "2345-7", fhirfly, value: 95, unit: "mg/dL" });
    expect(returned).toBe(bundle);
  });
});
