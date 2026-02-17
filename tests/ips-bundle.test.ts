import { describe, it, expect } from "vitest";
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

const fullPatient: IPS.PatientFull = {
  name: [
    { use: "official", given: ["Jane", "Quincy"], family: "Doe", prefix: ["Dr."] },
    { use: "maiden", family: "Smith" },
  ],
  birthDate: "1990-01-15",
  gender: "female",
  identifier: [{ system: "http://hospital.example/mrn", value: "12345" }],
  telecom: [{ system: "phone", value: "+1-555-0123", use: "mobile" }],
  address: [
    {
      use: "home",
      line: ["123 Main St"],
      city: "Springfield",
      state: "IL",
      postalCode: "62704",
      country: "US",
    },
  ],
  generalPractitioner: [{ display: "Dr. Gregory House" }],
  communication: [
    {
      language: { coding: [{ system: "urn:ietf:bcp:47", code: "en" }] },
      preferred: true,
    },
  ],
};

// ---------------------------------------------------------------------------
// Constructor & patient getter
// ---------------------------------------------------------------------------

describe("IPS.Bundle — constructor", () => {
  it("creates instance with shorthand patient", () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    expect(bundle).toBeInstanceOf(IPS.Bundle);
    expect(bundle.patient).toEqual(shorthandPatient);
  });

  it("creates instance with full FHIR patient", () => {
    const bundle = new IPS.Bundle(fullPatient);
    expect(bundle).toBeInstanceOf(IPS.Bundle);
    expect(bundle.patient).toEqual(fullPatient);
  });

  it("accepts shorthand with name as text string", () => {
    const bundle = new IPS.Bundle({
      name: "Dr. Jane Q. Doe III",
      birthDate: "1990-01-15",
    });
    expect(bundle.patient).toHaveProperty("name", "Dr. Jane Q. Doe III");
  });

  it("accepts shorthand with identifier as plain string", () => {
    const bundle = new IPS.Bundle({
      given: "Jane",
      family: "Doe",
      birthDate: "1990-01-15",
      identifier: "MRN-12345",
    });
    expect(bundle.patient).toHaveProperty("identifier", "MRN-12345");
  });

  it("accepts shorthand with identifier as { system, value }", () => {
    const bundle = new IPS.Bundle({
      given: "Jane",
      family: "Doe",
      birthDate: "1990-01-15",
      identifier: { system: "http://hospital.example/mrn", value: "12345" },
    });
    expect(bundle.patient).toHaveProperty("identifier");
  });
});

// ---------------------------------------------------------------------------
// add* methods (unchanged behavior — still return this for chaining)
// ---------------------------------------------------------------------------

describe("IPS.Bundle — add methods", () => {
  it("addMedication returns this", () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = bundle.addMedication({
      code: "860975",
      system: "http://www.nlm.nih.gov/research/umls/rxnorm",
      display: "Metformin 500 MG Oral Tablet",
      status: "active",
    });
    expect(result).toBe(bundle);
  });

  it("addAllergy returns this", () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = bundle.addAllergy({
      code: "387517004",
      system: "http://snomed.info/sct",
      display: "Paracetamol",
      clinicalStatus: "active",
    });
    expect(result).toBe(bundle);
  });

  it("addCondition returns this", () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = bundle.addCondition({
      code: "E11.9",
      system: "http://hl7.org/fhir/sid/icd-10-cm",
      display: "Type 2 diabetes mellitus without complications",
      clinicalStatus: "active",
    });
    expect(result).toBe(bundle);
  });

  it("addImmunization returns this", () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = bundle.addImmunization({
      code: "207",
      system: "http://hl7.org/fhir/sid/cvx",
      display: "COVID-19 vaccine",
      occurrenceDate: "2024-01-15",
      status: "completed",
    });
    expect(result).toBe(bundle);
  });

  it("supports method chaining", () => {
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
      })
      .addCondition({
        code: "E11.9",
        system: "http://hl7.org/fhir/sid/icd-10-cm",
        display: "Type 2 diabetes",
      })
      .addImmunization({
        code: "207",
        system: "http://hl7.org/fhir/sid/cvx",
        display: "COVID-19 vaccine",
      });
    expect(result).toBe(bundle);
  });
});

// ---------------------------------------------------------------------------
// build() — output structure
// ---------------------------------------------------------------------------

describe("IPS.Bundle — build()", () => {
  it("returns a FHIR document Bundle", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = await bundle.build({ profile: "ips" });

    expect(result.resourceType).toBe("Bundle");
    expect(result.type).toBe("document");
    expect(result.id).toEqual(expect.any(String));
    expect(result.timestamp).toEqual(expect.any(String));
  });

  it("has two entries: Composition and Patient", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;

    expect(entries).toHaveLength(2);
    expect(entries[0]!.resource.resourceType).toBe("Composition");
    expect(entries[1]!.resource.resourceType).toBe("Patient");
  });

  it("entries have urn:uuid fullUrl references", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;

    expect(entries[0]!.fullUrl).toMatch(/^urn:uuid:[0-9a-f-]+$/);
    expect(entries[1]!.fullUrl).toMatch(/^urn:uuid:[0-9a-f-]+$/);
  });

  it("uses provided bundleId", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = await bundle.build({ profile: "ips", bundleId: "my-custom-id" });

    expect(result.id).toBe("my-custom-id");
  });

  it("has identifier with urn:uuid system (bdl-9)", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = await bundle.build({ profile: "ips", bundleId: "test-bundle-id" });
    const identifier = result.identifier as { system: string; value: string };

    expect(identifier).toBeDefined();
    expect(identifier.system).toBe("urn:ietf:rfc:3986");
    expect(identifier.value).toBe("urn:uuid:test-bundle-id");
  });

  it("identifier value matches generated bundle id", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = await bundle.build({ profile: "ips" });
    const identifier = result.identifier as { system: string; value: string };

    expect(identifier.value).toBe(`urn:uuid:${result.id as string}`);
  });

  it("uses provided compositionDate", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const date = "2024-06-15T10:00:00Z";
    const result = await bundle.build({ profile: "ips", compositionDate: date });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;

    expect(result.timestamp).toBe(date);
    expect(entries[0]!.resource.date).toBe(date);
  });

  it("defaults profile to ips when options omitted", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = await bundle.build();
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;
    const patient = entries[1]!.resource;

    // IPS profile: Patient has meta.profile
    expect(patient.meta).toEqual({
      profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/Patient-uv-ips"],
    });
  });
});

// ---------------------------------------------------------------------------
// build() — shorthand Patient mapping
// ---------------------------------------------------------------------------

describe("IPS.Bundle — build() with shorthand patient", () => {
  it("maps given/family to name[0].given/family", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;
    const patient = entries[1]!.resource;
    const names = patient.name as Array<Record<string, unknown>>;

    expect(names).toHaveLength(1);
    expect(names[0]!.given).toEqual(["Jane"]);
    expect(names[0]!.family).toBe("Doe");
  });

  it("maps name text string to name[0].text", async () => {
    const bundle = new IPS.Bundle({
      name: "Dr. Jane Q. Doe III",
      birthDate: "1990-01-15",
    });
    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;
    const patient = entries[1]!.resource;
    const names = patient.name as Array<Record<string, unknown>>;

    expect(names).toHaveLength(1);
    expect(names[0]!.text).toBe("Dr. Jane Q. Doe III");
  });

  it("maps phone and email to telecom", async () => {
    const bundle = new IPS.Bundle({
      given: "Jane",
      family: "Doe",
      birthDate: "1990-01-15",
      phone: "+1-555-0123",
      email: "jane@example.com",
    });
    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;
    const patient = entries[1]!.resource;
    const telecom = patient.telecom as Array<Record<string, unknown>>;

    expect(telecom).toHaveLength(2);
    expect(telecom[0]).toEqual({ system: "phone", value: "+1-555-0123" });
    expect(telecom[1]).toEqual({ system: "email", value: "jane@example.com" });
  });

  it("maps string identifier to identifier[0].value", async () => {
    const bundle = new IPS.Bundle({
      given: "Jane",
      family: "Doe",
      birthDate: "1990-01-15",
      identifier: "MRN-12345",
    });
    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;
    const patient = entries[1]!.resource;
    const identifiers = patient.identifier as Array<Record<string, unknown>>;

    expect(identifiers).toHaveLength(1);
    expect(identifiers[0]!.value).toBe("MRN-12345");
  });

  it("maps { system, value } identifier correctly", async () => {
    const bundle = new IPS.Bundle({
      given: "Jane",
      family: "Doe",
      birthDate: "1990-01-15",
      identifier: { system: "http://hospital.example/mrn", value: "12345" },
    });
    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;
    const patient = entries[1]!.resource;
    const identifiers = patient.identifier as Array<Record<string, unknown>>;

    expect(identifiers).toHaveLength(1);
    expect(identifiers[0]).toEqual({
      system: "http://hospital.example/mrn",
      value: "12345",
    });
  });

  it("includes IPS profile meta for ips profile", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;
    const patient = entries[1]!.resource;

    expect(patient.meta).toEqual({
      profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/Patient-uv-ips"],
    });
  });

  it("excludes profile meta for r4 profile", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = await bundle.build({ profile: "r4" });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;
    const patient = entries[1]!.resource;

    expect(patient.meta).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// build() — full FHIR Patient passthrough
// ---------------------------------------------------------------------------

describe("IPS.Bundle — build() with full FHIR patient", () => {
  it("passes through name array directly", async () => {
    const bundle = new IPS.Bundle(fullPatient);
    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;
    const patient = entries[1]!.resource;

    expect(patient.name).toEqual(fullPatient.name);
  });

  it("passes through telecom, address, identifier", async () => {
    const bundle = new IPS.Bundle(fullPatient);
    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;
    const patient = entries[1]!.resource;

    expect(patient.telecom).toEqual(fullPatient.telecom);
    expect(patient.address).toEqual(fullPatient.address);
    expect(patient.identifier).toEqual(fullPatient.identifier);
  });

  it("passes through generalPractitioner and communication", async () => {
    const bundle = new IPS.Bundle(fullPatient);
    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;
    const patient = entries[1]!.resource;

    expect(patient.generalPractitioner).toEqual(fullPatient.generalPractitioner);
    expect(patient.communication).toEqual(fullPatient.communication);
  });

  it("maps deceased boolean to deceasedBoolean", async () => {
    const bundle = new IPS.Bundle({
      ...fullPatient,
      deceased: true,
    });
    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;
    const patient = entries[1]!.resource;

    expect(patient.deceasedBoolean).toBe(true);
    expect(patient.deceasedDateTime).toBeUndefined();
  });

  it("maps deceased string to deceasedDateTime", async () => {
    const bundle = new IPS.Bundle({
      ...fullPatient,
      deceased: "2024-01-15",
    });
    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;
    const patient = entries[1]!.resource;

    expect(patient.deceasedDateTime).toBe("2024-01-15");
    expect(patient.deceasedBoolean).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// build() — Composition
// ---------------------------------------------------------------------------

describe("IPS.Bundle — build() Composition", () => {
  it("has correct Composition fields", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;
    const composition = entries[0]!.resource;

    expect(composition.resourceType).toBe("Composition");
    expect(composition.status).toBe("final");
    expect(composition.title).toBe("International Patient Summary");
    expect(composition.author).toEqual([{ display: "FHIRfly SHL SDK" }]);
  });

  it("has LOINC 60591-5 type coding", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;
    const composition = entries[0]!.resource;
    const type = composition.type as { coding: Array<{ system: string; code: string }> };

    expect(type.coding[0]!.system).toBe("http://loinc.org");
    expect(type.coding[0]!.code).toBe("60591-5");
  });

  it("subject references Patient entry fullUrl", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;
    const composition = entries[0]!.resource;
    const patientFullUrl = entries[1]!.fullUrl;
    const subject = composition.subject as { reference: string };

    expect(subject.reference).toBe(patientFullUrl);
  });

  it("has IPS profile meta for ips profile", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;
    const composition = entries[0]!.resource;

    expect(composition.meta).toEqual({
      profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/Composition-uv-ips"],
    });
  });

  it("has no profile meta for r4 profile", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = await bundle.build({ profile: "r4" });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;
    const composition = entries[0]!.resource;

    expect(composition.meta).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// build() — empty required sections
// ---------------------------------------------------------------------------

describe("IPS.Bundle — empty required sections", () => {
  it("IPS profile has 3 required sections with emptyReason", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;
    const composition = entries[0]!.resource;
    const sections = composition.section as Array<Record<string, unknown>>;

    expect(sections).toHaveLength(3);

    const titles = sections.map((s) => s.title);
    expect(titles).toContain("Medication Summary");
    expect(titles).toContain("Allergies and Intolerances");
    expect(titles).toContain("Problem List");
  });

  it("each empty section has emptyReason with notasked code", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = await bundle.build({ profile: "ips" });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;
    const composition = entries[0]!.resource;
    const sections = composition.section as Array<Record<string, unknown>>;

    for (const section of sections) {
      const emptyReason = section.emptyReason as {
        coding: Array<{ system: string; code: string }>;
      };
      expect(emptyReason.coding[0]!.system).toBe(
        "http://terminology.hl7.org/CodeSystem/list-empty-reason",
      );
      expect(emptyReason.coding[0]!.code).toBe("notasked");
    }
  });

  it("r4 profile has no required sections", async () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = await bundle.build({ profile: "r4" });
    const entries = result.entry as Array<{ fullUrl: string; resource: Record<string, unknown> }>;
    const composition = entries[0]!.resource;

    expect(composition.section).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// validate()
// ---------------------------------------------------------------------------

describe("IPS.Bundle — validate()", () => {
  it("returns valid for correct shorthand input", () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    const result = bundle.validate({ profile: "ips" });

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("returns valid for correct full FHIR input", () => {
    const bundle = new IPS.Bundle(fullPatient);
    const result = bundle.validate({ profile: "ips" });

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("catches missing name (ips-pat-1 violation)", () => {
    const bundle = new IPS.Bundle({
      birthDate: "1990-01-15",
      gender: "female",
    });
    const result = bundle.validate({ profile: "ips" });

    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.severity).toBe("error");
    expect(result.issues[0]!.message).toContain("ips-pat-1");
    expect(result.issues[0]!.path).toBe("Patient.name");
  });

  it("catches invalid birthDate format", () => {
    const bundle = new IPS.Bundle({
      given: "Jane",
      family: "Doe",
      birthDate: "January 15, 1990",
      gender: "female",
    });
    const result = bundle.validate({ profile: "ips" });

    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path === "Patient.birthDate")).toBe(true);
  });

  it("does not check ips-pat-1 for r4 profile", () => {
    const bundle = new IPS.Bundle({
      birthDate: "1990-01-15",
      gender: "female",
    });
    const result = bundle.validate({ profile: "r4" });

    // Only birthDate format check, no ips-pat-1
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("accepts name as text string for ips-pat-1", () => {
    const bundle = new IPS.Bundle({
      name: "Jane Doe",
      birthDate: "1990-01-15",
    });
    const result = bundle.validate({ profile: "ips" });

    expect(result.valid).toBe(true);
  });

  it("validates full FHIR patient with empty name array as invalid", () => {
    const bundle = new IPS.Bundle({
      name: [],
      birthDate: "1990-01-15",
      gender: "female",
    });
    const result = bundle.validate({ profile: "ips" });

    expect(result.valid).toBe(false);
    expect(result.issues[0]!.message).toContain("ips-pat-1");
  });

  it("defaults to ips profile when options omitted", () => {
    const bundle = new IPS.Bundle({
      birthDate: "1990-01-15",
    });
    const result = bundle.validate();

    // Should fail ips-pat-1 (no name)
    expect(result.valid).toBe(false);
  });

  it("warns when gender is missing", () => {
    const bundle = new IPS.Bundle({
      given: "Jane",
      family: "Doe",
      birthDate: "1990-01-15",
    });
    const result = bundle.validate({ profile: "ips" });

    expect(result.valid).toBe(true);
    const genderIssue = result.issues.find((i) => i.path === "Patient.gender");
    expect(genderIssue).toBeDefined();
    expect(genderIssue!.severity).toBe("warning");
  });

  it("informs when medication has no effectiveDate", () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({
      code: "860975",
      system: "http://www.nlm.nih.gov/research/umls/rxnorm",
      display: "Metformin 500 MG Oral Tablet",
    });
    const result = bundle.validate({ profile: "ips" });

    expect(result.valid).toBe(true);
    const medIssue = result.issues.find((i) => i.path === "MedicationStatement.effectiveDateTime");
    expect(medIssue).toBeDefined();
    expect(medIssue!.severity).toBe("information");
  });

  it("informs when condition has no onsetDate", () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addCondition({
      code: "44054006",
      system: "http://snomed.info/sct",
      display: "Type 2 diabetes mellitus",
    });
    const result = bundle.validate({ profile: "ips" });

    expect(result.valid).toBe(true);
    const condIssue = result.issues.find((i) => i.path === "Condition.onsetDateTime");
    expect(condIssue).toBeDefined();
    expect(condIssue!.severity).toBe("information");
  });

  it("informs when immunization has no occurrenceDate", () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addImmunization({
      code: "207",
      system: "http://hl7.org/fhir/sid/cvx",
      display: "COVID-19 vaccine",
    });
    const result = bundle.validate({ profile: "ips" });

    expect(result.valid).toBe(true);
    const immIssue = result.issues.find((i) => i.path === "Immunization.occurrenceDateTime");
    expect(immIssue).toBeDefined();
    expect(immIssue!.severity).toBe("information");
  });

  it("warns when fromResource medication missing effective[x]", () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({
      fromResource: {
        resourceType: "MedicationStatement",
        status: "active",
        medicationCodeableConcept: {
          coding: [{ system: "http://www.nlm.nih.gov/research/umls/rxnorm", code: "860975" }],
        },
      },
    });
    const result = bundle.validate({ profile: "ips" });

    expect(result.valid).toBe(true);
    const effIssue = result.issues.find((i) => i.path === "MedicationStatement.effective[x]");
    expect(effIssue).toBeDefined();
    expect(effIssue!.severity).toBe("warning");
  });

  it("returns no issues for fully-specified bundle", () => {
    const bundle = new IPS.Bundle(shorthandPatient);
    bundle.addMedication({
      code: "860975",
      system: "http://www.nlm.nih.gov/research/umls/rxnorm",
      display: "Metformin 500 MG Oral Tablet",
      effectiveDate: "2024-01-15",
    });
    bundle.addCondition({
      code: "44054006",
      system: "http://snomed.info/sct",
      display: "Type 2 diabetes mellitus",
      onsetDate: "2020-03-01",
    });
    bundle.addImmunization({
      code: "207",
      system: "http://hl7.org/fhir/sid/cvx",
      display: "COVID-19 vaccine",
      occurrenceDate: "2024-01-15",
    });
    const result = bundle.validate({ profile: "ips" });

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("does not warn about dates for r4 profile", () => {
    const bundle = new IPS.Bundle({
      given: "Jane",
      family: "Doe",
      birthDate: "1990-01-15",
    });
    bundle.addMedication({
      code: "860975",
      system: "http://www.nlm.nih.gov/research/umls/rxnorm",
      display: "Metformin 500 MG Oral Tablet",
    });
    bundle.addCondition({
      code: "44054006",
      system: "http://snomed.info/sct",
      display: "Type 2 diabetes",
    });
    bundle.addImmunization({
      code: "207",
      system: "http://hl7.org/fhir/sid/cvx",
      display: "COVID-19 vaccine",
    });
    const result = bundle.validate({ profile: "r4" });

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});
