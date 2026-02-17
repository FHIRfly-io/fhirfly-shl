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
          snomed: [{ concept_id: "376988009", display: "Atorvastatin", map_type: "equivalent" }],
        },
      }),
    },
    rxnorm: {
      lookup: vi.fn().mockResolvedValue({
        data: {
          rxcui: "161",
          name: "Acetaminophen",
          tty: "IN",
          snomed: [{ concept_id: "387517004", display: "Paracetamol", map_type: "equivalent" }],
        },
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
  };
}

/** Mock FhirflyClient where all lookups fail. */
function createFailingFhirfly(): IPS.FhirflyClient {
  return {
    ndc: { lookup: vi.fn().mockRejectedValue(new Error("Network error")) },
    rxnorm: { lookup: vi.fn().mockRejectedValue(new Error("Network error")) },
    snomed: { lookup: vi.fn().mockRejectedValue(new Error("Network error")) },
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

function getMedStatements(result: Record<string, unknown>): BundleEntry[] {
  return getEntries(result).filter((e) => e.resource.resourceType === "MedicationStatement");
}

function getMedRequests(result: Record<string, unknown>): BundleEntry[] {
  return getEntries(result).filter((e) => e.resource.resourceType === "MedicationRequest");
}

function getMedSection(result: Record<string, unknown>): Record<string, unknown> {
  const composition = getComposition(result);
  const sections = composition.section as Array<Record<string, unknown>>;
  return sections.find((s) => s.title === "Medication Summary")!;
}

// ---------------------------------------------------------------------------
// Manual input (code/system/display)
// ---------------------------------------------------------------------------

describe("addMedication — manual input", () => {
  it("produces a MedicationStatement in the Bundle", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({
      code: "860975",
      system: "http://www.nlm.nih.gov/research/umls/rxnorm",
      display: "Metformin 500 MG Oral Tablet",
      status: "active",
    });

    const result = await bundle.build({ profile: "ips" });
    const meds = getMedStatements(result);

    expect(meds).toHaveLength(1);
    const med = meds[0]!.resource;
    expect(med.resourceType).toBe("MedicationStatement");
    expect(med.status).toBe("active");

    const medCC = med.medicationCodeableConcept as { coding: Array<Record<string, string>>; text?: string };
    expect(medCC.coding).toHaveLength(1);
    expect(medCC.coding[0]!.system).toBe("http://www.nlm.nih.gov/research/umls/rxnorm");
    expect(medCC.coding[0]!.code).toBe("860975");
    expect(medCC.coding[0]!.display).toBe("Metformin 500 MG Oral Tablet");
    expect(medCC.text).toBe("Metformin 500 MG Oral Tablet");
  });

  it("defaults status to active", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({
      code: "860975",
      system: "http://www.nlm.nih.gov/research/umls/rxnorm",
      display: "Metformin 500 MG Oral Tablet",
    });

    const result = await bundle.build({ profile: "ips" });
    const med = getMedStatements(result)[0]!.resource;
    expect(med.status).toBe("active");
  });

  it("includes dosage text when provided", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({
      code: "860975",
      system: "http://www.nlm.nih.gov/research/umls/rxnorm",
      display: "Metformin 500 MG Oral Tablet",
      dosageText: "Take 1 tablet daily",
    });

    const result = await bundle.build({ profile: "ips" });
    const med = getMedStatements(result)[0]!.resource;
    const dosage = med.dosage as Array<{ text: string }>;
    expect(dosage).toHaveLength(1);
    expect(dosage[0]!.text).toBe("Take 1 tablet daily");
  });

  it("includes IPS profile meta on MedicationStatement", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({
      code: "860975",
      system: "http://www.nlm.nih.gov/research/umls/rxnorm",
      display: "Metformin 500 MG Oral Tablet",
    });

    const result = await bundle.build({ profile: "ips" });
    const med = getMedStatements(result)[0]!.resource;
    expect(med.meta).toEqual({
      profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/MedicationStatement-uv-ips"],
    });
  });

  it("excludes profile meta for r4 profile", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({
      code: "860975",
      system: "http://www.nlm.nih.gov/research/umls/rxnorm",
      display: "Metformin 500 MG Oral Tablet",
    });

    const result = await bundle.build({ profile: "r4" });
    const med = getMedStatements(result)[0]!.resource;
    expect(med.meta).toBeUndefined();
  });

  it("includes effectiveDateTime when effectiveDate provided", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({
      code: "860975",
      system: "http://www.nlm.nih.gov/research/umls/rxnorm",
      display: "Metformin 500 MG Oral Tablet",
      effectiveDate: "2024-01-15",
    });

    const result = await bundle.build({ profile: "ips" });
    const med = getMedStatements(result)[0]!.resource;
    expect(med.effectiveDateTime).toBe("2024-01-15");
  });

  it("defaults effectiveDateTime to current date when omitted", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({
      code: "860975",
      system: "http://www.nlm.nih.gov/research/umls/rxnorm",
      display: "Metformin 500 MG Oral Tablet",
    });

    const result = await bundle.build({ profile: "ips" });
    const med = getMedStatements(result)[0]!.resource;
    expect(med.effectiveDateTime).toBeDefined();
    // Should be a YYYY-MM-DD date string
    expect(med.effectiveDateTime).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("subject references the Patient entry", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({
      code: "860975",
      system: "http://www.nlm.nih.gov/research/umls/rxnorm",
      display: "Metformin 500 MG Oral Tablet",
    });

    const result = await bundle.build({ profile: "ips" });
    const entries = getEntries(result);
    const patientFullUrl = entries[1]!.fullUrl;
    const med = getMedStatements(result)[0]!.resource;
    const subject = med.subject as { reference: string };

    expect(subject.reference).toBe(patientFullUrl);
  });
});

// ---------------------------------------------------------------------------
// bySNOMED — without fhirfly
// ---------------------------------------------------------------------------

describe("addMedication — bySNOMED without fhirfly", () => {
  it("creates SNOMED coding with user-provided display", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({
      bySNOMED: "376988009",
      display: "Atorvastatin",
    });

    const result = await bundle.build({ profile: "ips" });
    const med = getMedStatements(result)[0]!.resource;
    const medCC = med.medicationCodeableConcept as { coding: Array<Record<string, string>> };

    expect(medCC.coding).toHaveLength(1);
    expect(medCC.coding[0]!.system).toBe("http://snomed.info/sct");
    expect(medCC.coding[0]!.code).toBe("376988009");
    expect(medCC.coding[0]!.display).toBe("Atorvastatin");
  });

  it("emits warning when no display provided", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({ bySNOMED: "376988009" });

    await bundle.build({ profile: "ips" });

    expect(bundle.warnings.length).toBeGreaterThan(0);
    expect(bundle.warnings.some((w) => w.message.includes("No display name"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// bySNOMED — with fhirfly
// ---------------------------------------------------------------------------

describe("addMedication — bySNOMED with fhirfly", () => {
  it("uses preferred_term from API as display", async () => {
    const fhirfly = createMockFhirfly();
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({
      bySNOMED: "376988009",
      display: "User-provided name",
      fhirfly,
    });

    const result = await bundle.build({ profile: "ips" });
    const med = getMedStatements(result)[0]!.resource;
    const medCC = med.medicationCodeableConcept as { coding: Array<Record<string, string>>; text?: string };

    // API preferred_term overrides user display
    expect(medCC.coding[0]!.display).toBe("Atorvastatin");
    expect(medCC.text).toBe("Atorvastatin");
    expect(fhirfly.snomed.lookup).toHaveBeenCalledWith("376988009");
  });

  it("falls back to user display on API failure", async () => {
    const fhirfly = createFailingFhirfly();
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({
      bySNOMED: "376988009",
      display: "User-provided name",
      fhirfly,
    });

    const result = await bundle.build({ profile: "ips" });
    const med = getMedStatements(result)[0]!.resource;
    const medCC = med.medicationCodeableConcept as { coding: Array<Record<string, string>> };

    expect(medCC.coding[0]!.display).toBe("User-provided name");
    expect(bundle.warnings.some((w) => w.message.includes("SNOMED lookup failed"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// byNDC + mock fhirfly
// ---------------------------------------------------------------------------

describe("addMedication — byNDC", () => {
  it("produces NDC + SNOMED codings from API", async () => {
    const fhirfly = createMockFhirfly();
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({
      byNDC: "0069-3150-83",
      fhirfly,
    });

    const result = await bundle.build({ profile: "ips" });
    const med = getMedStatements(result)[0]!.resource;
    const medCC = med.medicationCodeableConcept as { coding: Array<Record<string, string>>; text?: string };

    expect(medCC.coding).toHaveLength(2);
    expect(medCC.coding[0]!.system).toBe("http://hl7.org/fhir/sid/ndc");
    expect(medCC.coding[0]!.code).toBe("0069-3150-83");
    expect(medCC.coding[0]!.display).toBe("Lipitor 10mg Tablet");
    expect(medCC.coding[1]!.system).toBe("http://snomed.info/sct");
    expect(medCC.coding[1]!.code).toBe("376988009");
    expect(medCC.text).toBe("Lipitor 10mg Tablet");

    expect(fhirfly.ndc.lookup).toHaveBeenCalledWith("0069-3150-83", { shape: "full" });
  });

  it("passes through effectiveDate for byNDC", async () => {
    const fhirfly = createMockFhirfly();
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({
      byNDC: "0069-3150-83",
      fhirfly,
      effectiveDate: "2023-06-01",
    });

    const result = await bundle.build({ profile: "ips" });
    const med = getMedStatements(result)[0]!.resource;
    expect(med.effectiveDateTime).toBe("2023-06-01");
  });

  it("degrades gracefully on API failure", async () => {
    const fhirfly = createFailingFhirfly();
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({
      byNDC: "0069-3150-83",
      fhirfly,
    });

    const result = await bundle.build({ profile: "ips" });
    const med = getMedStatements(result)[0]!.resource;
    const medCC = med.medicationCodeableConcept as { coding: Array<Record<string, string>> };

    // Still included with bare code
    expect(medCC.coding).toHaveLength(1);
    expect(medCC.coding[0]!.system).toBe("http://hl7.org/fhir/sid/ndc");
    expect(medCC.coding[0]!.code).toBe("0069-3150-83");
    expect(medCC.coding[0]!.display).toBeUndefined();

    expect(bundle.warnings.some((w) => w.message.includes("NDC lookup failed"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// byRxNorm + mock fhirfly
// ---------------------------------------------------------------------------

describe("addMedication — byRxNorm", () => {
  it("produces RxNorm + SNOMED codings from API", async () => {
    const fhirfly = createMockFhirfly();
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({
      byRxNorm: "161",
      fhirfly,
    });

    const result = await bundle.build({ profile: "ips" });
    const med = getMedStatements(result)[0]!.resource;
    const medCC = med.medicationCodeableConcept as { coding: Array<Record<string, string>>; text?: string };

    expect(medCC.coding).toHaveLength(2);
    expect(medCC.coding[0]!.system).toBe("http://www.nlm.nih.gov/research/umls/rxnorm");
    expect(medCC.coding[0]!.code).toBe("161");
    expect(medCC.coding[0]!.display).toBe("Acetaminophen");
    expect(medCC.coding[1]!.system).toBe("http://snomed.info/sct");
    expect(medCC.coding[1]!.code).toBe("387517004");
    expect(medCC.text).toBe("Acetaminophen");

    expect(fhirfly.rxnorm.lookup).toHaveBeenCalledWith("161", { shape: "full" });
  });

  it("degrades gracefully on API failure", async () => {
    const fhirfly = createFailingFhirfly();
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({
      byRxNorm: "161",
      fhirfly,
    });

    const result = await bundle.build({ profile: "ips" });
    const med = getMedStatements(result)[0]!.resource;
    const medCC = med.medicationCodeableConcept as { coding: Array<Record<string, string>> };

    expect(medCC.coding).toHaveLength(1);
    expect(medCC.coding[0]!.code).toBe("161");
    expect(medCC.coding[0]!.display).toBeUndefined();

    expect(bundle.warnings.some((w) => w.message.includes("RxNorm lookup failed"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// fromResource
// ---------------------------------------------------------------------------

describe("addMedication — fromResource", () => {
  it("passes through MedicationStatement", async () => {
    const existingResource = {
      resourceType: "MedicationStatement",
      status: "active",
      medicationCodeableConcept: {
        coding: [
          {
            system: "http://www.nlm.nih.gov/research/umls/rxnorm",
            code: "860975",
            display: "Metformin 500 MG Oral Tablet",
          },
        ],
      },
      subject: { reference: "Patient/old-ref" },
    };

    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({ fromResource: existingResource });

    const result = await bundle.build({ profile: "ips" });
    const meds = getMedStatements(result);
    expect(meds).toHaveLength(1);

    const med = meds[0]!.resource;
    expect(med.resourceType).toBe("MedicationStatement");
    expect(med.status).toBe("active");

    // Subject rewritten to point to bundle patient
    const patientFullUrl = getEntries(result)[1]!.fullUrl;
    expect((med.subject as { reference: string }).reference).toBe(patientFullUrl);

    // Gets new UUID id
    expect(med.id).toMatch(/^[0-9a-f-]+$/);
  });

  it("passes through MedicationRequest", async () => {
    const existingResource = {
      resourceType: "MedicationRequest",
      status: "active",
      intent: "order",
      medicationCodeableConcept: {
        coding: [
          {
            system: "http://www.nlm.nih.gov/research/umls/rxnorm",
            code: "860975",
            display: "Metformin 500 MG Oral Tablet",
          },
        ],
      },
      subject: { reference: "Patient/old-ref" },
    };

    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({ fromResource: existingResource });

    const result = await bundle.build({ profile: "ips" });
    const medRequests = getMedRequests(result);
    expect(medRequests).toHaveLength(1);

    const med = medRequests[0]!.resource;
    expect(med.resourceType).toBe("MedicationRequest");

    // Subject rewritten
    const patientFullUrl = getEntries(result)[1]!.fullUrl;
    expect((med.subject as { reference: string }).reference).toBe(patientFullUrl);
  });

  it("throws on wrong resourceType", () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    expect(() => {
      bundle.addMedication({
        fromResource: {
          resourceType: "Observation",
          status: "final",
        },
      });
    }).toThrow("MedicationStatement");
  });

  it("emits warning for missing status", () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({
      fromResource: {
        resourceType: "MedicationStatement",
        medicationCodeableConcept: {
          coding: [{ system: "http://snomed.info/sct", code: "123456", display: "Test" }],
        },
      },
    });

    expect(bundle.warnings.some((w) => w.message.includes('missing "status"'))).toBe(true);
  });

  it("emits warning for missing medicationCodeableConcept", () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({
      fromResource: {
        resourceType: "MedicationStatement",
        status: "active",
      },
    });

    expect(bundle.warnings.some((w) => w.message.includes("medicationCodeableConcept"))).toBe(true);
  });

  it("enriches with SNOMED via NDC when fhirfly provided", async () => {
    const fhirfly = createMockFhirfly();
    const existingResource = {
      resourceType: "MedicationStatement",
      status: "active",
      medicationCodeableConcept: {
        coding: [
          {
            system: "http://hl7.org/fhir/sid/ndc",
            code: "0069-3150-83",
            display: "Lipitor 10mg",
          },
        ],
      },
      subject: { reference: "Patient/old" },
    };

    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({ fromResource: existingResource, fhirfly });

    const result = await bundle.build({ profile: "ips" });
    const med = getMedStatements(result)[0]!.resource;
    const medCC = med.medicationCodeableConcept as { coding: Array<Record<string, string>> };

    // Should have original NDC + enriched SNOMED
    expect(medCC.coding.length).toBeGreaterThanOrEqual(2);
    expect(medCC.coding.some((c) => c.system === "http://snomed.info/sct")).toBe(true);
  });

  it("does not add SNOMED if already present", async () => {
    const fhirfly = createMockFhirfly();
    const existingResource = {
      resourceType: "MedicationStatement",
      status: "active",
      medicationCodeableConcept: {
        coding: [
          { system: "http://hl7.org/fhir/sid/ndc", code: "0069-3150-83" },
          { system: "http://snomed.info/sct", code: "existing-snomed", display: "Existing" },
        ],
      },
      subject: { reference: "Patient/old" },
    };

    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({ fromResource: existingResource, fhirfly });

    const result = await bundle.build({ profile: "ips" });
    const med = getMedStatements(result)[0]!.resource;
    const medCC = med.medicationCodeableConcept as { coding: Array<Record<string, string>> };

    // SNOMED already existed, should NOT add more
    const snomedCodings = medCC.coding.filter((c) => c.system === "http://snomed.info/sct");
    expect(snomedCodings).toHaveLength(1);
    expect(snomedCodings[0]!.code).toBe("existing-snomed");

    // Should NOT have called NDC lookup since SNOMED already present
    expect(fhirfly.ndc.lookup).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Composition section population
// ---------------------------------------------------------------------------

describe("addMedication — Composition section", () => {
  it("populates Medication Summary section with entry refs", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({
      code: "860975",
      system: "http://www.nlm.nih.gov/research/umls/rxnorm",
      display: "Metformin 500 MG Oral Tablet",
    });

    const result = await bundle.build({ profile: "ips" });
    const medSection = getMedSection(result);

    const entries = medSection.entry as Array<{ reference: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.reference).toMatch(/^urn:uuid:/);

    // No emptyReason when entries exist
    expect(medSection.emptyReason).toBeUndefined();

    // Generated narrative
    const text = medSection.text as { status: string; div: string };
    expect(text.status).toBe("generated");
  });

  it("has emptyReason when no medications", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = await bundle.build({ profile: "ips" });
    const medSection = getMedSection(result);

    expect(medSection.entry).toBeUndefined();
    expect(medSection.emptyReason).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Multiple medications
// ---------------------------------------------------------------------------

describe("addMedication — multiple entries", () => {
  it("all medications appear as Bundle entries", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle
      .addMedication({
        code: "860975",
        system: "http://www.nlm.nih.gov/research/umls/rxnorm",
        display: "Metformin 500 MG Oral Tablet",
      })
      .addMedication({
        bySNOMED: "376988009",
        display: "Atorvastatin",
      })
      .addMedication({
        code: "197361",
        system: "http://www.nlm.nih.gov/research/umls/rxnorm",
        display: "Amlodipine 5 MG Oral Tablet",
      });

    const result = await bundle.build({ profile: "ips" });
    const meds = getMedStatements(result);
    expect(meds).toHaveLength(3);

    // Composition section has 3 refs
    const medSection = getMedSection(result);
    const sectionEntries = medSection.entry as Array<{ reference: string }>;
    expect(sectionEntries).toHaveLength(3);

    // Bundle has 5 entries total: Composition + Patient + 3 meds
    expect(getEntries(result)).toHaveLength(5);
  });
});

// ---------------------------------------------------------------------------
// Method chaining preserved
// ---------------------------------------------------------------------------

describe("addMedication — method chaining", () => {
  it("addMedication().addAllergy() still works", () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = bundle
      .addMedication({
        code: "860975",
        system: "http://www.nlm.nih.gov/research/umls/rxnorm",
        display: "Metformin 500 MG Oral Tablet",
      })
      .addAllergy({
        code: "387517004",
        system: "http://snomed.info/sct",
        display: "Paracetamol",
      });
    expect(result).toBe(bundle);
  });
});

// ---------------------------------------------------------------------------
// Warnings getter
// ---------------------------------------------------------------------------

describe("bundle.warnings", () => {
  it("combines add-time and build-time warnings", async () => {
    const fhirfly = createFailingFhirfly();
    const bundle = new IPS.Bundle(shorthandPatient);

    // Add-time warning (missing status on fromResource)
    bundle.addMedication({
      fromResource: {
        resourceType: "MedicationStatement",
        medicationCodeableConcept: {
          coding: [{ system: "http://snomed.info/sct", code: "123", display: "Test" }],
        },
      },
    });

    // Build-time warning (NDC lookup failure)
    bundle.addMedication({ byNDC: "bad-ndc", fhirfly });

    await bundle.build({ profile: "ips" });

    // Should have at least: missing status warning + NDC failure warning
    expect(bundle.warnings.length).toBeGreaterThanOrEqual(2);
    expect(bundle.warnings.some((w) => w.message.includes('missing "status"'))).toBe(true);
    expect(bundle.warnings.some((w) => w.message.includes("NDC lookup failed"))).toBe(true);
  });

  it("is empty when no issues", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({
      code: "860975",
      system: "http://www.nlm.nih.gov/research/umls/rxnorm",
      display: "Metformin 500 MG Oral Tablet",
    });

    await bundle.build({ profile: "ips" });
    expect(bundle.warnings).toHaveLength(0);
  });
});
