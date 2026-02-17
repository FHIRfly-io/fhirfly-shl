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
          snomed: [],
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
          concept_id: "376988009",
          preferred_term: "Atorvastatin",
          fsn: "Atorvastatin (substance)",
          ips_category: "substance",
        },
      }),
    },
    icd10: {
      lookup: vi.fn().mockResolvedValue({
        data: { code: "E11.9", display: "Type 2 diabetes", snomed: [] },
      }),
    },
    cvx: {
      lookup: vi.fn().mockResolvedValue({
        data: {
          code: "207",
          display: "COVID-19, mRNA, LNP-S, PF, 100 mcg/0.5mL dose",
          full_vaccine_name: "COVID-19 vaccine, mRNA, LNP-S, PF, 100 mcg/0.5mL dose",
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

function getImmunizations(result: Record<string, unknown>): BundleEntry[] {
  return getEntries(result).filter((e) => e.resource.resourceType === "Immunization");
}

function getImmunizationSection(result: Record<string, unknown>): Record<string, unknown> | undefined {
  const composition = getComposition(result);
  const sections = composition.section as Array<Record<string, unknown>> | undefined;
  if (!sections) return undefined;
  return sections.find((s) => s.title === "History of Immunizations");
}

// ---------------------------------------------------------------------------
// Manual input (code/system/display)
// ---------------------------------------------------------------------------

describe("addImmunization — manual input", () => {
  it("produces an Immunization in the Bundle", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addImmunization({
      code: "207",
      system: "http://hl7.org/fhir/sid/cvx",
      display: "COVID-19 vaccine",
    });

    const result = await bundle.build({ profile: "ips" });
    const immunizations = getImmunizations(result);

    expect(immunizations).toHaveLength(1);
    const imm = immunizations[0]!.resource;
    expect(imm.resourceType).toBe("Immunization");

    const vaccineCode = imm.vaccineCode as { coding: Array<Record<string, string>>; text?: string };
    expect(vaccineCode.coding).toHaveLength(1);
    expect(vaccineCode.coding[0]!.system).toBe("http://hl7.org/fhir/sid/cvx");
    expect(vaccineCode.coding[0]!.code).toBe("207");
    expect(vaccineCode.coding[0]!.display).toBe("COVID-19 vaccine");
    expect(vaccineCode.text).toBe("COVID-19 vaccine");
  });

  it("uses vaccineCode not code", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addImmunization({
      code: "207",
      system: "http://hl7.org/fhir/sid/cvx",
      display: "COVID-19 vaccine",
    });

    const result = await bundle.build({ profile: "ips" });
    const imm = getImmunizations(result)[0]!.resource;

    expect(imm.vaccineCode).toBeDefined();
    expect(imm.code).toBeUndefined();
  });

  it("defaults status to completed", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addImmunization({
      code: "207",
      system: "http://hl7.org/fhir/sid/cvx",
      display: "COVID-19 vaccine",
    });

    const result = await bundle.build({ profile: "ips" });
    const imm = getImmunizations(result)[0]!.resource;
    expect(imm.status).toBe("completed");
  });

  it("includes occurrenceDateTime when provided", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addImmunization({
      code: "207",
      system: "http://hl7.org/fhir/sid/cvx",
      display: "COVID-19 vaccine",
      occurrenceDate: "2024-01-15",
    });

    const result = await bundle.build({ profile: "ips" });
    const imm = getImmunizations(result)[0]!.resource;
    expect(imm.occurrenceDateTime).toBe("2024-01-15");
  });

  it("includes IPS profile meta on Immunization", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addImmunization({
      code: "207",
      system: "http://hl7.org/fhir/sid/cvx",
      display: "COVID-19 vaccine",
    });

    const result = await bundle.build({ profile: "ips" });
    const imm = getImmunizations(result)[0]!.resource;
    expect(imm.meta).toEqual({
      profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/Immunization-uv-ips"],
    });
  });

  it("excludes profile meta for r4 profile", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addImmunization({
      code: "207",
      system: "http://hl7.org/fhir/sid/cvx",
      display: "COVID-19 vaccine",
    });

    const result = await bundle.build({ profile: "r4" });
    const imm = getImmunizations(result)[0]!.resource;
    expect(imm.meta).toBeUndefined();
  });

  it("uses patient (not subject) reference", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addImmunization({
      code: "207",
      system: "http://hl7.org/fhir/sid/cvx",
      display: "COVID-19 vaccine",
    });

    const result = await bundle.build({ profile: "ips" });
    const entries = getEntries(result);
    const patientFullUrl = entries[1]!.fullUrl;
    const imm = getImmunizations(result)[0]!.resource;
    const patient = imm.patient as { reference: string };

    expect(patient.reference).toBe(patientFullUrl);
    expect(imm.subject).toBeUndefined();
  });

  it("accepts not-done status", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addImmunization({
      code: "207",
      system: "http://hl7.org/fhir/sid/cvx",
      display: "COVID-19 vaccine",
      status: "not-done",
    });

    const result = await bundle.build({ profile: "ips" });
    const imm = getImmunizations(result)[0]!.resource;
    expect(imm.status).toBe("not-done");
  });
});

// ---------------------------------------------------------------------------
// byCVX + mock fhirfly
// ---------------------------------------------------------------------------

describe("addImmunization — byCVX", () => {
  it("enriches with vaccine name from API", async () => {
    const fhirfly = createMockFhirfly();
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addImmunization({
      byCVX: "207",
      fhirfly,
    });

    const result = await bundle.build({ profile: "ips" });
    const imm = getImmunizations(result)[0]!.resource;
    const vaccineCode = imm.vaccineCode as { coding: Array<Record<string, string>>; text?: string };

    expect(vaccineCode.coding).toHaveLength(1);
    expect(vaccineCode.coding[0]!.system).toBe("http://hl7.org/fhir/sid/cvx");
    expect(vaccineCode.coding[0]!.code).toBe("207");
    expect(vaccineCode.coding[0]!.display).toBe("COVID-19, mRNA, LNP-S, PF, 100 mcg/0.5mL dose");
    expect(vaccineCode.text).toBe("COVID-19, mRNA, LNP-S, PF, 100 mcg/0.5mL dose");

    expect(fhirfly.cvx.lookup).toHaveBeenCalledWith("207");
  });

  it("degrades gracefully on API failure", async () => {
    const fhirfly = createFailingFhirfly();
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addImmunization({
      byCVX: "207",
      fhirfly,
    });

    const result = await bundle.build({ profile: "ips" });
    const imm = getImmunizations(result)[0]!.resource;
    const vaccineCode = imm.vaccineCode as { coding: Array<Record<string, string>> };

    expect(vaccineCode.coding).toHaveLength(1);
    expect(vaccineCode.coding[0]!.system).toBe("http://hl7.org/fhir/sid/cvx");
    expect(vaccineCode.coding[0]!.code).toBe("207");
    expect(vaccineCode.coding[0]!.display).toBeUndefined();

    expect(bundle.warnings.some((w) => w.message.includes("CVX lookup failed"))).toBe(true);
  });

  it("defaults status to completed for byCVX", async () => {
    const fhirfly = createMockFhirfly();
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addImmunization({ byCVX: "207", fhirfly });

    const result = await bundle.build({ profile: "ips" });
    const imm = getImmunizations(result)[0]!.resource;
    expect(imm.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// fromResource
// ---------------------------------------------------------------------------

describe("addImmunization — fromResource", () => {
  it("passes through Immunization resource", async () => {
    const existingResource = {
      resourceType: "Immunization",
      status: "completed",
      vaccineCode: {
        coding: [
          {
            system: "http://hl7.org/fhir/sid/cvx",
            code: "207",
            display: "COVID-19 vaccine",
          },
        ],
      },
      patient: { reference: "Patient/old-ref" },
    };

    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addImmunization({ fromResource: existingResource });

    const result = await bundle.build({ profile: "ips" });
    const immunizations = getImmunizations(result);
    expect(immunizations).toHaveLength(1);

    const imm = immunizations[0]!.resource;
    expect(imm.resourceType).toBe("Immunization");

    // Patient rewritten to point to bundle patient
    const patientFullUrl = getEntries(result)[1]!.fullUrl;
    expect((imm.patient as { reference: string }).reference).toBe(patientFullUrl);

    expect(imm.id).toMatch(/^[0-9a-f-]+$/);
  });

  it("throws on wrong resourceType", () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    expect(() => {
      bundle.addImmunization({
        fromResource: {
          resourceType: "Observation",
          status: "final",
        },
      });
    }).toThrow("Immunization");
  });

  it("emits warning for missing status", () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addImmunization({
      fromResource: {
        resourceType: "Immunization",
        vaccineCode: {
          coding: [{ system: "http://hl7.org/fhir/sid/cvx", code: "207", display: "COVID-19" }],
        },
      },
    });

    expect(bundle.warnings.some((w) => w.message.includes('missing "status"'))).toBe(true);
  });

  it("emits warning for missing vaccineCode", () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addImmunization({
      fromResource: {
        resourceType: "Immunization",
        status: "completed",
      },
    });

    expect(bundle.warnings.some((w) => w.message.includes('missing "vaccineCode"'))).toBe(true);
  });

  it("adds IPS profile meta on passthrough Immunization", async () => {
    const existingResource = {
      resourceType: "Immunization",
      status: "completed",
      vaccineCode: {
        coding: [{ system: "http://hl7.org/fhir/sid/cvx", code: "207", display: "COVID-19" }],
      },
    };

    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addImmunization({ fromResource: existingResource });

    const result = await bundle.build({ profile: "ips" });
    const imm = getImmunizations(result)[0]!.resource;
    expect(imm.meta).toEqual({
      profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/Immunization-uv-ips"],
    });
  });
});

// ---------------------------------------------------------------------------
// Composition section population
// ---------------------------------------------------------------------------

describe("addImmunization — Composition section", () => {
  it("populates Immunizations section with entry refs", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addImmunization({
      code: "207",
      system: "http://hl7.org/fhir/sid/cvx",
      display: "COVID-19 vaccine",
    });

    const result = await bundle.build({ profile: "ips" });
    const immSection = getImmunizationSection(result);

    expect(immSection).toBeDefined();
    const entries = immSection!.entry as Array<{ reference: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.reference).toMatch(/^urn:uuid:/);

    expect(immSection!.emptyReason).toBeUndefined();

    const text = immSection!.text as { status: string };
    expect(text.status).toBe("generated");
  });

  it("immunization section has correct LOINC 11369-6 display", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addImmunization({
      code: "207",
      system: "http://hl7.org/fhir/sid/cvx",
      display: "COVID-19 vaccine",
    });

    const result = await bundle.build({ profile: "ips" });
    const immSection = getImmunizationSection(result);
    expect(immSection).toBeDefined();

    const code = immSection!.code as { coding: Array<{ system: string; code: string; display: string }> };
    expect(code.coding[0]!.code).toBe("11369-6");
    expect(code.coding[0]!.display).toBe("History of Immunization note");
  });

  it("no Immunization section when no immunizations", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = await bundle.build({ profile: "ips" });
    const immSection = getImmunizationSection(result);

    // Immunization is not a required IPS section, so it should not appear when empty
    expect(immSection).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Multiple immunizations
// ---------------------------------------------------------------------------

describe("addImmunization — multiple entries", () => {
  it("all immunizations appear as Bundle entries", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle
      .addImmunization({
        code: "207",
        system: "http://hl7.org/fhir/sid/cvx",
        display: "COVID-19 vaccine",
      })
      .addImmunization({
        code: "141",
        system: "http://hl7.org/fhir/sid/cvx",
        display: "Influenza vaccine",
      });

    const result = await bundle.build({ profile: "ips" });
    const immunizations = getImmunizations(result);
    expect(immunizations).toHaveLength(2);

    const immSection = getImmunizationSection(result);
    expect(immSection).toBeDefined();
    const sectionEntries = immSection!.entry as Array<{ reference: string }>;
    expect(sectionEntries).toHaveLength(2);
  });
});
