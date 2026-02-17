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
          concept_id: "91936005",
          preferred_term: "Allergy to penicillin",
          fsn: "Allergy to penicillin (finding)",
          ips_category: "finding",
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
          display: "COVID-19 vaccine",
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

function getAllergies(result: Record<string, unknown>): BundleEntry[] {
  return getEntries(result).filter((e) => e.resource.resourceType === "AllergyIntolerance");
}

function getAllergySection(result: Record<string, unknown>): Record<string, unknown> {
  const composition = getComposition(result);
  const sections = composition.section as Array<Record<string, unknown>>;
  return sections.find((s) => s.title === "Allergies and Intolerances")!;
}

// ---------------------------------------------------------------------------
// Manual input (code/system/display)
// ---------------------------------------------------------------------------

describe("addAllergy — manual input", () => {
  it("produces an AllergyIntolerance in the Bundle", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addAllergy({
      code: "91936005",
      system: "http://snomed.info/sct",
      display: "Allergy to penicillin",
    });

    const result = await bundle.build({ profile: "ips" });
    const allergies = getAllergies(result);

    expect(allergies).toHaveLength(1);
    const allergy = allergies[0]!.resource;
    expect(allergy.resourceType).toBe("AllergyIntolerance");

    const code = allergy.code as { coding: Array<Record<string, string>>; text?: string };
    expect(code.coding).toHaveLength(1);
    expect(code.coding[0]!.system).toBe("http://snomed.info/sct");
    expect(code.coding[0]!.code).toBe("91936005");
    expect(code.coding[0]!.display).toBe("Allergy to penicillin");
    expect(code.text).toBe("Allergy to penicillin");
  });

  it("defaults clinicalStatus to active", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addAllergy({
      code: "91936005",
      system: "http://snomed.info/sct",
      display: "Allergy to penicillin",
    });

    const result = await bundle.build({ profile: "ips" });
    const allergy = getAllergies(result)[0]!.resource;
    const cs = allergy.clinicalStatus as { coding: Array<{ system: string; code: string }> };
    expect(cs.coding[0]!.code).toBe("active");
    expect(cs.coding[0]!.system).toBe(
      "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
    );
  });

  it("includes criticality when provided", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addAllergy({
      code: "91936005",
      system: "http://snomed.info/sct",
      display: "Allergy to penicillin",
      criticality: "high",
    });

    const result = await bundle.build({ profile: "ips" });
    const allergy = getAllergies(result)[0]!.resource;
    expect(allergy.criticality).toBe("high");
  });

  it("includes IPS profile meta on AllergyIntolerance", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addAllergy({
      code: "91936005",
      system: "http://snomed.info/sct",
      display: "Allergy to penicillin",
    });

    const result = await bundle.build({ profile: "ips" });
    const allergy = getAllergies(result)[0]!.resource;
    expect(allergy.meta).toEqual({
      profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/AllergyIntolerance-uv-ips"],
    });
  });

  it("excludes profile meta for r4 profile", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addAllergy({
      code: "91936005",
      system: "http://snomed.info/sct",
      display: "Allergy to penicillin",
    });

    const result = await bundle.build({ profile: "r4" });
    const allergy = getAllergies(result)[0]!.resource;
    expect(allergy.meta).toBeUndefined();
  });

  it("uses patient (not subject) reference", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addAllergy({
      code: "91936005",
      system: "http://snomed.info/sct",
      display: "Allergy to penicillin",
    });

    const result = await bundle.build({ profile: "ips" });
    const entries = getEntries(result);
    const patientFullUrl = entries[1]!.fullUrl;
    const allergy = getAllergies(result)[0]!.resource;
    const patient = allergy.patient as { reference: string };

    expect(patient.reference).toBe(patientFullUrl);
    expect(allergy.subject).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// bySNOMED — without fhirfly
// ---------------------------------------------------------------------------

describe("addAllergy — bySNOMED without fhirfly", () => {
  it("creates SNOMED coding with user-provided display", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addAllergy({
      bySNOMED: "91936005",
      display: "Allergy to penicillin",
    });

    const result = await bundle.build({ profile: "ips" });
    const allergy = getAllergies(result)[0]!.resource;
    const code = allergy.code as { coding: Array<Record<string, string>> };

    expect(code.coding).toHaveLength(1);
    expect(code.coding[0]!.system).toBe("http://snomed.info/sct");
    expect(code.coding[0]!.code).toBe("91936005");
    expect(code.coding[0]!.display).toBe("Allergy to penicillin");
  });

  it("emits warning when no display provided", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addAllergy({ bySNOMED: "91936005" });

    await bundle.build({ profile: "ips" });

    expect(bundle.warnings.length).toBeGreaterThan(0);
    expect(bundle.warnings.some((w) => w.message.includes("No display name"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bySNOMED — with fhirfly
// ---------------------------------------------------------------------------

describe("addAllergy — bySNOMED with fhirfly", () => {
  it("uses preferred_term from API as display", async () => {
    const fhirfly = createMockFhirfly();
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addAllergy({
      bySNOMED: "91936005",
      display: "User-provided name",
      fhirfly,
    });

    const result = await bundle.build({ profile: "ips" });
    const allergy = getAllergies(result)[0]!.resource;
    const code = allergy.code as { coding: Array<Record<string, string>>; text?: string };

    expect(code.coding[0]!.display).toBe("Allergy to penicillin");
    expect(code.text).toBe("Allergy to penicillin");
    expect(fhirfly.snomed.lookup).toHaveBeenCalledWith("91936005");
  });

  it("falls back to user display on API failure", async () => {
    const fhirfly = createFailingFhirfly();
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addAllergy({
      bySNOMED: "91936005",
      display: "User-provided name",
      fhirfly,
    });

    const result = await bundle.build({ profile: "ips" });
    const allergy = getAllergies(result)[0]!.resource;
    const code = allergy.code as { coding: Array<Record<string, string>> };

    expect(code.coding[0]!.display).toBe("User-provided name");
    expect(bundle.warnings.some((w) => w.message.includes("SNOMED lookup failed"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fromResource
// ---------------------------------------------------------------------------

describe("addAllergy — fromResource", () => {
  it("passes through AllergyIntolerance resource", async () => {
    const existingResource = {
      resourceType: "AllergyIntolerance",
      clinicalStatus: {
        coding: [
          { system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" },
        ],
      },
      code: {
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "91936005",
            display: "Allergy to penicillin",
          },
        ],
      },
      patient: { reference: "Patient/old-ref" },
    };

    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addAllergy({ fromResource: existingResource });

    const result = await bundle.build({ profile: "ips" });
    const allergies = getAllergies(result);
    expect(allergies).toHaveLength(1);

    const allergy = allergies[0]!.resource;
    expect(allergy.resourceType).toBe("AllergyIntolerance");

    // Patient rewritten to point to bundle patient
    const patientFullUrl = getEntries(result)[1]!.fullUrl;
    expect((allergy.patient as { reference: string }).reference).toBe(patientFullUrl);

    expect(allergy.id).toMatch(/^[0-9a-f-]+$/);
  });

  it("throws on wrong resourceType", () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    expect(() => {
      bundle.addAllergy({
        fromResource: {
          resourceType: "Observation",
          status: "final",
        },
      });
    }).toThrow("AllergyIntolerance");
  });

  it("emits warning for missing clinicalStatus", () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addAllergy({
      fromResource: {
        resourceType: "AllergyIntolerance",
        code: {
          coding: [{ system: "http://snomed.info/sct", code: "91936005", display: "Penicillin allergy" }],
        },
      },
    });

    expect(bundle.warnings.some((w) => w.message.includes('missing "clinicalStatus"'))).toBe(true);
  });

  it("emits warning for missing code", () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addAllergy({
      fromResource: {
        resourceType: "AllergyIntolerance",
        clinicalStatus: {
          coding: [
            { system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" },
          ],
        },
      },
    });

    expect(bundle.warnings.some((w) => w.message.includes('missing "code"'))).toBe(true);
  });

  it("adds IPS profile meta on passthrough AllergyIntolerance", async () => {
    const existingResource = {
      resourceType: "AllergyIntolerance",
      clinicalStatus: {
        coding: [
          { system: "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical", code: "active" },
        ],
      },
      code: {
        coding: [{ system: "http://snomed.info/sct", code: "91936005", display: "Penicillin allergy" }],
      },
    };

    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addAllergy({ fromResource: existingResource });

    const result = await bundle.build({ profile: "ips" });
    const allergy = getAllergies(result)[0]!.resource;
    expect(allergy.meta).toEqual({
      profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/AllergyIntolerance-uv-ips"],
    });
  });
});

// ---------------------------------------------------------------------------
// Composition section population
// ---------------------------------------------------------------------------

describe("addAllergy — Composition section", () => {
  it("populates Allergies section with entry refs", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addAllergy({
      code: "91936005",
      system: "http://snomed.info/sct",
      display: "Allergy to penicillin",
    });

    const result = await bundle.build({ profile: "ips" });
    const allergySection = getAllergySection(result);

    const entries = allergySection.entry as Array<{ reference: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.reference).toMatch(/^urn:uuid:/);

    expect(allergySection.emptyReason).toBeUndefined();

    const text = allergySection.text as { status: string };
    expect(text.status).toBe("generated");
  });

  it("has emptyReason when no allergies", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = await bundle.build({ profile: "ips" });
    const allergySection = getAllergySection(result);

    expect(allergySection.entry).toBeUndefined();
    expect(allergySection.emptyReason).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Multiple allergies
// ---------------------------------------------------------------------------

describe("addAllergy — multiple entries", () => {
  it("all allergies appear as Bundle entries", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle
      .addAllergy({
        code: "91936005",
        system: "http://snomed.info/sct",
        display: "Allergy to penicillin",
      })
      .addAllergy({
        bySNOMED: "418689008",
        display: "Allergy to grass pollen",
      });

    const result = await bundle.build({ profile: "ips" });
    const allergies = getAllergies(result);
    expect(allergies).toHaveLength(2);

    const allergySection = getAllergySection(result);
    const sectionEntries = allergySection.entry as Array<{ reference: string }>;
    expect(sectionEntries).toHaveLength(2);
  });
});
