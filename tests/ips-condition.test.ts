import { describe, it, expect, vi } from "vitest";
import { IPS } from "../src/index.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const shorthandPatient: IPS.PatientShorthand = {
  given: "Jane",
  family: "Doe",
  birthDate: "1990-01-15",
  gender: "female",
};

/** Mock FhirflyClient that returns successful responses. */
function createMockFhirfly(): IPS.FhirflyClient {
  return {
    ndc: {
      lookup: vi.fn().mockResolvedValue({
        data: {
          ndc: "0069-3150-83",
          product_name: "Lipitor 10mg Tablet",
          generic_name: "Atorvastatin Calcium",
          dosage_form: "TABLET",
          route: "ORAL",
          active_ingredients: [{ name: "ATORVASTATIN CALCIUM", strength: "10", unit: "mg" }],
          snomed: [{ concept_id: "376988009", display: "Atorvastatin" }],
        },
      }),
    },
    rxnorm: {
      lookup: vi.fn().mockResolvedValue({
        data: { rxcui: "161", name: "Acetaminophen", tty: "IN", snomed: [] },
      }),
    },
    snomed: {
      lookup: vi.fn().mockResolvedValue({
        data: {
          concept_id: "73211009",
          preferred_term: "Diabetes mellitus",
          fsn: "Diabetes mellitus (disorder)",
          ips_category: "disorder",
        },
      }),
    },
    icd10: {
      lookup: vi.fn().mockResolvedValue({
        data: {
          code: "E11.9",
          display: "Type 2 diabetes mellitus without complications",
          snomed: [
            { concept_id: "44054006", display: "Diabetes mellitus type 2", map_type: "equivalent" },
          ],
        },
      }),
    },
    cvx: {
      lookup: vi.fn().mockResolvedValue({
        data: {
          code: "207",
          display: "COVID-19, mRNA, LNP-S, PF, 100 mcg/0.5mL dose",
          full_vaccine_name: "COVID-19 vaccine, mRNA",
        },
      }),
    },
  };
}

/** Mock FhirflyClient where all lookups fail. */
function createFailingFhirfly(): IPS.FhirflyClient {
  return {
    ndc: { lookup: vi.fn().mockRejectedValue(new Error("Network error")) },
    rxnorm: { lookup: vi.fn().mockRejectedValue(new Error("Network error")) },
    snomed: { lookup: vi.fn().mockRejectedValue(new Error("Network error")) },
    icd10: { lookup: vi.fn().mockRejectedValue(new Error("Network error")) },
    cvx: { lookup: vi.fn().mockRejectedValue(new Error("Network error")) },
  };
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

type BundleEntry = { fullUrl: string; resource: Record<string, unknown> };

function getEntries(result: Record<string, unknown>): BundleEntry[] {
  return result.entry as BundleEntry[];
}

function getComposition(result: Record<string, unknown>): Record<string, unknown> {
  return getEntries(result)[0]!.resource;
}

function getConditions(result: Record<string, unknown>): BundleEntry[] {
  return getEntries(result).filter((e) => e.resource.resourceType === "Condition");
}

function getConditionSection(result: Record<string, unknown>): Record<string, unknown> {
  const composition = getComposition(result);
  const sections = composition.section as Array<Record<string, unknown>>;
  return sections.find((s) => s.title === "Problem List")!;
}

// ---------------------------------------------------------------------------
// Manual input (code/system/display)
// ---------------------------------------------------------------------------

describe("addCondition — manual input", () => {
  it("produces a Condition in the Bundle", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addCondition({
      code: "E11.9",
      system: "http://hl7.org/fhir/sid/icd-10-cm",
      display: "Type 2 diabetes mellitus without complications",
    });

    const result = await bundle.build({ profile: "ips" });
    const conditions = getConditions(result);

    expect(conditions).toHaveLength(1);
    const cond = conditions[0]!.resource;
    expect(cond.resourceType).toBe("Condition");

    const code = cond.code as { coding: Array<Record<string, string>>; text?: string };
    expect(code.coding).toHaveLength(1);
    expect(code.coding[0]!.system).toBe("http://hl7.org/fhir/sid/icd-10-cm");
    expect(code.coding[0]!.code).toBe("E11.9");
    expect(code.coding[0]!.display).toBe("Type 2 diabetes mellitus without complications");
    expect(code.text).toBe("Type 2 diabetes mellitus without complications");
  });

  it("defaults clinicalStatus to active", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addCondition({
      code: "E11.9",
      system: "http://hl7.org/fhir/sid/icd-10-cm",
      display: "Type 2 diabetes",
    });

    const result = await bundle.build({ profile: "ips" });
    const cond = getConditions(result)[0]!.resource;
    const cs = cond.clinicalStatus as { coding: Array<{ system: string; code: string }> };
    expect(cs.coding[0]!.code).toBe("active");
    expect(cs.coding[0]!.system).toBe(
      "http://terminology.hl7.org/CodeSystem/condition-clinical",
    );
  });

  it("clinicalStatus is a CodeableConcept, not a string", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addCondition({
      code: "E11.9",
      system: "http://hl7.org/fhir/sid/icd-10-cm",
      display: "Type 2 diabetes",
      clinicalStatus: "remission",
    });

    const result = await bundle.build({ profile: "ips" });
    const cond = getConditions(result)[0]!.resource;
    const cs = cond.clinicalStatus as { coding: Array<{ system: string; code: string }> };
    expect(cs).toHaveProperty("coding");
    expect(Array.isArray(cs.coding)).toBe(true);
    expect(cs.coding[0]!.code).toBe("remission");
  });

  it("includes onsetDateTime when provided", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addCondition({
      code: "E11.9",
      system: "http://hl7.org/fhir/sid/icd-10-cm",
      display: "Type 2 diabetes",
      onsetDate: "2020-06-15",
    });

    const result = await bundle.build({ profile: "ips" });
    const cond = getConditions(result)[0]!.resource;
    expect(cond.onsetDateTime).toBe("2020-06-15");
  });

  it("includes IPS profile meta on Condition", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addCondition({
      code: "E11.9",
      system: "http://hl7.org/fhir/sid/icd-10-cm",
      display: "Type 2 diabetes",
    });

    const result = await bundle.build({ profile: "ips" });
    const cond = getConditions(result)[0]!.resource;
    expect(cond.meta).toEqual({
      profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/Condition-uv-ips"],
    });
  });

  it("excludes profile meta for r4 profile", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addCondition({
      code: "E11.9",
      system: "http://hl7.org/fhir/sid/icd-10-cm",
      display: "Type 2 diabetes",
    });

    const result = await bundle.build({ profile: "r4" });
    const cond = getConditions(result)[0]!.resource;
    expect(cond.meta).toBeUndefined();
  });

  it("subject references the Patient entry", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addCondition({
      code: "E11.9",
      system: "http://hl7.org/fhir/sid/icd-10-cm",
      display: "Type 2 diabetes",
    });

    const result = await bundle.build({ profile: "ips" });
    const entries = getEntries(result);
    const patientFullUrl = entries[1]!.fullUrl;
    const cond = getConditions(result)[0]!.resource;
    const subject = cond.subject as { reference: string };

    expect(subject.reference).toBe(patientFullUrl);
  });
});

// ---------------------------------------------------------------------------
// bySNOMED — without fhirfly
// ---------------------------------------------------------------------------

describe("addCondition — bySNOMED without fhirfly", () => {
  it("creates SNOMED coding with user-provided display", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addCondition({
      bySNOMED: "73211009",
      display: "Diabetes mellitus",
    });

    const result = await bundle.build({ profile: "ips" });
    const cond = getConditions(result)[0]!.resource;
    const code = cond.code as { coding: Array<Record<string, string>> };

    expect(code.coding).toHaveLength(1);
    expect(code.coding[0]!.system).toBe("http://snomed.info/sct");
    expect(code.coding[0]!.code).toBe("73211009");
    expect(code.coding[0]!.display).toBe("Diabetes mellitus");
  });

  it("emits warning when no display provided", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addCondition({ bySNOMED: "73211009" });

    await bundle.build({ profile: "ips" });

    expect(bundle.warnings.length).toBeGreaterThan(0);
    expect(bundle.warnings.some((w) => w.message.includes("No display name"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bySNOMED — with fhirfly
// ---------------------------------------------------------------------------

describe("addCondition — bySNOMED with fhirfly", () => {
  it("uses preferred_term from API as display", async () => {
    const fhirfly = createMockFhirfly();
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addCondition({
      bySNOMED: "73211009",
      display: "User-provided name",
      fhirfly,
    });

    const result = await bundle.build({ profile: "ips" });
    const cond = getConditions(result)[0]!.resource;
    const code = cond.code as { coding: Array<Record<string, string>>; text?: string };

    expect(code.coding[0]!.display).toBe("Diabetes mellitus");
    expect(code.text).toBe("Diabetes mellitus");
    expect(fhirfly.snomed.lookup).toHaveBeenCalledWith("73211009");
  });

  it("falls back to user display on API failure", async () => {
    const fhirfly = createFailingFhirfly();
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addCondition({
      bySNOMED: "73211009",
      display: "User-provided name",
      fhirfly,
    });

    const result = await bundle.build({ profile: "ips" });
    const cond = getConditions(result)[0]!.resource;
    const code = cond.code as { coding: Array<Record<string, string>> };

    expect(code.coding[0]!.display).toBe("User-provided name");
    expect(bundle.warnings.some((w) => w.message.includes("SNOMED lookup failed"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// byICD10 + mock fhirfly
// ---------------------------------------------------------------------------

describe("addCondition — byICD10", () => {
  it("produces ICD-10 + SNOMED codings from API", async () => {
    const fhirfly = createMockFhirfly();
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addCondition({
      byICD10: "E11.9",
      fhirfly,
    });

    const result = await bundle.build({ profile: "ips" });
    const cond = getConditions(result)[0]!.resource;
    const code = cond.code as { coding: Array<Record<string, string>>; text?: string };

    expect(code.coding).toHaveLength(2);
    expect(code.coding[0]!.system).toBe("http://hl7.org/fhir/sid/icd-10-cm");
    expect(code.coding[0]!.code).toBe("E11.9");
    expect(code.coding[0]!.display).toBe("Type 2 diabetes mellitus without complications");
    expect(code.coding[1]!.system).toBe("http://snomed.info/sct");
    expect(code.coding[1]!.code).toBe("44054006");
    expect(code.text).toBe("Type 2 diabetes mellitus without complications");

    expect(fhirfly.icd10.lookup).toHaveBeenCalledWith("E11.9", { shape: "standard" });
  });

  it("degrades gracefully on API failure", async () => {
    const fhirfly = createFailingFhirfly();
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addCondition({
      byICD10: "E11.9",
      fhirfly,
    });

    const result = await bundle.build({ profile: "ips" });
    const cond = getConditions(result)[0]!.resource;
    const code = cond.code as { coding: Array<Record<string, string>> };

    expect(code.coding).toHaveLength(1);
    expect(code.coding[0]!.system).toBe("http://hl7.org/fhir/sid/icd-10-cm");
    expect(code.coding[0]!.code).toBe("E11.9");
    expect(code.coding[0]!.display).toBeUndefined();

    expect(bundle.warnings.some((w) => w.message.includes("ICD-10 lookup failed"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fromResource
// ---------------------------------------------------------------------------

describe("addCondition — fromResource", () => {
  it("passes through Condition resource", async () => {
    const existingResource = {
      resourceType: "Condition",
      clinicalStatus: {
        coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }],
      },
      code: {
        coding: [
          {
            system: "http://hl7.org/fhir/sid/icd-10-cm",
            code: "E11.9",
            display: "Type 2 diabetes",
          },
        ],
      },
      subject: { reference: "Patient/old-ref" },
    };

    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addCondition({ fromResource: existingResource });

    const result = await bundle.build({ profile: "ips" });
    const conditions = getConditions(result);
    expect(conditions).toHaveLength(1);

    const cond = conditions[0]!.resource;
    expect(cond.resourceType).toBe("Condition");

    // Subject rewritten to point to bundle patient
    const patientFullUrl = getEntries(result)[1]!.fullUrl;
    expect((cond.subject as { reference: string }).reference).toBe(patientFullUrl);

    // Gets new UUID id
    expect(cond.id).toMatch(/^[0-9a-f-]+$/);
  });

  it("throws on wrong resourceType", () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    expect(() => {
      bundle.addCondition({
        fromResource: {
          resourceType: "Observation",
          status: "final",
        },
      });
    }).toThrow("Condition");
  });

  it("emits warning for missing clinicalStatus", () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addCondition({
      fromResource: {
        resourceType: "Condition",
        code: {
          coding: [{ system: "http://snomed.info/sct", code: "73211009", display: "Diabetes" }],
        },
      },
    });

    expect(bundle.warnings.some((w) => w.message.includes('missing "clinicalStatus"'))).toBe(true);
  });

  it("emits warning for missing code", () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addCondition({
      fromResource: {
        resourceType: "Condition",
        clinicalStatus: {
          coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }],
        },
      },
    });

    expect(bundle.warnings.some((w) => w.message.includes('missing "code"'))).toBe(true);
  });

  it("enriches with SNOMED via ICD-10 when fhirfly provided", async () => {
    const fhirfly = createMockFhirfly();
    const existingResource = {
      resourceType: "Condition",
      clinicalStatus: {
        coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }],
      },
      code: {
        coding: [
          {
            system: "http://hl7.org/fhir/sid/icd-10-cm",
            code: "E11.9",
            display: "Type 2 diabetes",
          },
        ],
      },
      subject: { reference: "Patient/old" },
    };

    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addCondition({ fromResource: existingResource, fhirfly });

    const result = await bundle.build({ profile: "ips" });
    const cond = getConditions(result)[0]!.resource;
    const code = cond.code as { coding: Array<Record<string, string>> };

    // Should have original ICD-10 + enriched SNOMED
    expect(code.coding.length).toBeGreaterThanOrEqual(2);
    expect(code.coding.some((c) => c.system === "http://snomed.info/sct")).toBe(true);
  });

  it("does not add SNOMED if already present", async () => {
    const fhirfly = createMockFhirfly();
    const existingResource = {
      resourceType: "Condition",
      clinicalStatus: {
        coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }],
      },
      code: {
        coding: [
          { system: "http://hl7.org/fhir/sid/icd-10-cm", code: "E11.9" },
          { system: "http://snomed.info/sct", code: "existing-snomed", display: "Existing" },
        ],
      },
      subject: { reference: "Patient/old" },
    };

    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addCondition({ fromResource: existingResource, fhirfly });

    const result = await bundle.build({ profile: "ips" });
    const cond = getConditions(result)[0]!.resource;
    const code = cond.code as { coding: Array<Record<string, string>> };

    const snomedCodings = code.coding.filter((c) => c.system === "http://snomed.info/sct");
    expect(snomedCodings).toHaveLength(1);
    expect(snomedCodings[0]!.code).toBe("existing-snomed");

    expect(fhirfly.icd10.lookup).not.toHaveBeenCalled();
  });

  it("adds IPS profile meta on passthrough Condition", async () => {
    const existingResource = {
      resourceType: "Condition",
      clinicalStatus: {
        coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }],
      },
      code: {
        coding: [{ system: "http://snomed.info/sct", code: "73211009", display: "Diabetes" }],
      },
    };

    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addCondition({ fromResource: existingResource });

    const result = await bundle.build({ profile: "ips" });
    const cond = getConditions(result)[0]!.resource;
    expect(cond.meta).toEqual({
      profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/Condition-uv-ips"],
    });
  });
});

// ---------------------------------------------------------------------------
// Composition section population
// ---------------------------------------------------------------------------

describe("addCondition — Composition section", () => {
  it("populates Problem List section with entry refs", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addCondition({
      code: "E11.9",
      system: "http://hl7.org/fhir/sid/icd-10-cm",
      display: "Type 2 diabetes",
    });

    const result = await bundle.build({ profile: "ips" });
    const condSection = getConditionSection(result);

    const entries = condSection.entry as Array<{ reference: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.reference).toMatch(/^urn:uuid:/);

    expect(condSection.emptyReason).toBeUndefined();

    const text = condSection.text as { status: string };
    expect(text.status).toBe("generated");
  });

  it("has emptyReason when no conditions", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = await bundle.build({ profile: "ips" });
    const condSection = getConditionSection(result);

    expect(condSection.entry).toBeUndefined();
    expect(condSection.emptyReason).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Multiple conditions
// ---------------------------------------------------------------------------

describe("addCondition — multiple entries", () => {
  it("all conditions appear as Bundle entries", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle
      .addCondition({
        code: "E11.9",
        system: "http://hl7.org/fhir/sid/icd-10-cm",
        display: "Type 2 diabetes",
      })
      .addCondition({
        bySNOMED: "73211009",
        display: "Diabetes mellitus",
      })
      .addCondition({
        code: "I10",
        system: "http://hl7.org/fhir/sid/icd-10-cm",
        display: "Essential hypertension",
      });

    const result = await bundle.build({ profile: "ips" });
    const conditions = getConditions(result);
    expect(conditions).toHaveLength(3);

    const condSection = getConditionSection(result);
    const sectionEntries = condSection.entry as Array<{ reference: string }>;
    expect(sectionEntries).toHaveLength(3);
  });
});
