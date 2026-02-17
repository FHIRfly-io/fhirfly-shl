import { describe, it, expect } from "vitest";
import {
  medicationNarrative,
  conditionNarrative,
  allergyNarrative,
  immunizationNarrative,
  patientNarrative,
} from "../src/ips/narrative.js";
import { IPS } from "../src/index.js";

const XHTML_NS = 'xmlns="http://www.w3.org/1999/xhtml"';

describe("narrative helpers", () => {
  describe("medicationNarrative", () => {
    it("includes display text, dosage, and effective date", () => {
      const div = medicationNarrative("Metformin 500 MG", "Take once daily", "2024-01-15");
      expect(div).toContain(XHTML_NS);
      expect(div).toContain("<b>Metformin 500 MG</b>");
      expect(div).toContain("Dosage: Take once daily");
      expect(div).toContain("Effective: 2024-01-15");
    });

    it("uses fallback when display text is undefined", () => {
      const div = medicationNarrative(undefined, undefined, undefined);
      expect(div).toContain("<b>Medication</b>");
      expect(div).not.toContain("Dosage:");
      expect(div).not.toContain("Effective:");
    });

    it("escapes HTML entities", () => {
      const div = medicationNarrative("<script>alert(1)</script>", undefined, undefined);
      expect(div).not.toContain("<script>");
      expect(div).toContain("&lt;script&gt;");
    });
  });

  describe("conditionNarrative", () => {
    it("includes display text, clinical status, and onset", () => {
      const div = conditionNarrative("Type 2 Diabetes", "active", "2020-03-10");
      expect(div).toContain(XHTML_NS);
      expect(div).toContain("<b>Type 2 Diabetes</b>");
      expect(div).toContain("Clinical Status: active");
      expect(div).toContain("Onset: 2020-03-10");
    });

    it("omits onset when undefined", () => {
      const div = conditionNarrative("Hypertension", "active", undefined);
      expect(div).toContain("<b>Hypertension</b>");
      expect(div).not.toContain("Onset:");
    });
  });

  describe("allergyNarrative", () => {
    it("includes display text, clinical status, and criticality", () => {
      const div = allergyNarrative("Penicillin", "active", "high");
      expect(div).toContain(XHTML_NS);
      expect(div).toContain("<b>Penicillin</b>");
      expect(div).toContain("Clinical Status: active");
      expect(div).toContain("Criticality: high");
    });

    it("omits criticality when undefined", () => {
      const div = allergyNarrative("Latex", "active", undefined);
      expect(div).toContain("<b>Latex</b>");
      expect(div).not.toContain("Criticality:");
    });
  });

  describe("immunizationNarrative", () => {
    it("includes display text, status, and date", () => {
      const div = immunizationNarrative("COVID-19 mRNA Vaccine", "completed", "2024-01-15");
      expect(div).toContain(XHTML_NS);
      expect(div).toContain("<b>COVID-19 mRNA Vaccine</b>");
      expect(div).toContain("Status: completed");
      expect(div).toContain("Date: 2024-01-15");
    });

    it("omits date when undefined", () => {
      const div = immunizationNarrative("Flu Shot", "completed", undefined);
      expect(div).toContain("<b>Flu Shot</b>");
      expect(div).not.toContain("Date:");
    });
  });

  describe("patientNarrative", () => {
    it("includes name, DOB, and gender", () => {
      const div = patientNarrative("Jane Doe", "1990-01-01", "female");
      expect(div).toContain(XHTML_NS);
      expect(div).toContain("<b>Jane Doe</b>");
      expect(div).toContain("DOB: 1990-01-01");
      expect(div).toContain("Gender: female");
    });

    it("omits gender when undefined", () => {
      const div = patientNarrative("John", "1985-06-15", undefined);
      expect(div).not.toContain("Gender:");
    });

    it("uses fallback when name is undefined", () => {
      const div = patientNarrative(undefined, "2000-01-01", undefined);
      expect(div).toContain("<b>Patient</b>");
    });
  });
});

describe("text.div on built resources", () => {
  it("MedicationStatement has text.div", async () => {
    const bundle = new IPS.Bundle({ given: "Test", family: "User", birthDate: "1990-01-01" });
    bundle.addMedication({
      code: "317896",
      system: "http://www.nlm.nih.gov/research/umls/rxnorm",
      display: "Metformin 500 MG Oral Tablet",
    });
    const fhir = await bundle.build();
    const med = fhir.entry.find(
      (e: Record<string, unknown>) =>
        (e.resource as Record<string, unknown>).resourceType === "MedicationStatement",
    );
    expect(med).toBeDefined();
    const text = (med!.resource as Record<string, unknown>).text as Record<string, unknown>;
    expect(text.status).toBe("generated");
    expect(text.div).toContain("Metformin 500 MG Oral Tablet");
    expect(text.div).toContain('xmlns="http://www.w3.org/1999/xhtml"');
  });

  it("Condition has text.div", async () => {
    const bundle = new IPS.Bundle({ given: "Test", family: "User", birthDate: "1990-01-01" });
    bundle.addCondition({
      code: "E11",
      system: "http://hl7.org/fhir/sid/icd-10",
      display: "Type 2 diabetes mellitus",
    });
    const fhir = await bundle.build();
    const cond = fhir.entry.find(
      (e: Record<string, unknown>) =>
        (e.resource as Record<string, unknown>).resourceType === "Condition",
    );
    expect(cond).toBeDefined();
    const text = (cond!.resource as Record<string, unknown>).text as Record<string, unknown>;
    expect(text.status).toBe("generated");
    expect(text.div).toContain("Type 2 diabetes mellitus");
  });

  it("AllergyIntolerance has text.div", async () => {
    const bundle = new IPS.Bundle({ given: "Test", family: "User", birthDate: "1990-01-01" });
    bundle.addAllergy({
      code: "91936005",
      system: "http://snomed.info/sct",
      display: "Allergy to penicillin",
    });
    const fhir = await bundle.build();
    const allergy = fhir.entry.find(
      (e: Record<string, unknown>) =>
        (e.resource as Record<string, unknown>).resourceType === "AllergyIntolerance",
    );
    expect(allergy).toBeDefined();
    const text = (allergy!.resource as Record<string, unknown>).text as Record<string, unknown>;
    expect(text.status).toBe("generated");
    expect(text.div).toContain("Allergy to penicillin");
  });

  it("Immunization has text.div", async () => {
    const bundle = new IPS.Bundle({ given: "Test", family: "User", birthDate: "1990-01-01" });
    bundle.addImmunization({
      code: "208",
      system: "http://hl7.org/fhir/sid/cvx",
      display: "COVID-19 mRNA LNP-S",
    });
    const fhir = await bundle.build();
    const imm = fhir.entry.find(
      (e: Record<string, unknown>) =>
        (e.resource as Record<string, unknown>).resourceType === "Immunization",
    );
    expect(imm).toBeDefined();
    const text = (imm!.resource as Record<string, unknown>).text as Record<string, unknown>;
    expect(text.status).toBe("generated");
    expect(text.div).toContain("COVID-19 mRNA LNP-S");
  });

  it("Patient has text.div", async () => {
    const bundle = new IPS.Bundle({ given: "Jane", family: "Doe", birthDate: "1990-01-01", gender: "female" });
    const fhir = await bundle.build();
    const pat = fhir.entry.find(
      (e: Record<string, unknown>) =>
        (e.resource as Record<string, unknown>).resourceType === "Patient",
    );
    expect(pat).toBeDefined();
    const text = (pat!.resource as Record<string, unknown>).text as Record<string, unknown>;
    expect(text.status).toBe("generated");
    expect(text.div).toContain("Jane Doe");
    expect(text.div).toContain("DOB: 1990-01-01");
    expect(text.div).toContain("Gender: female");
  });
});
