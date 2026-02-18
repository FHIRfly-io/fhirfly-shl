// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Section 4: SHL Consumption
 *
 * Decodes and decrypts SHLs created in sections 2 and 3, verifying
 * round-trip integrity of patient and clinical data.
 */

import { SHL } from "../../../src/index.js";
import type { ExerciseContext } from "../lib/types.js";

export async function runConsumption(ctx: ExerciseContext): Promise<void> {
  const { runner } = ctx;
  runner.section("Section 4: SHL Consumption");

  // --- Decode FhirflyStorage SHL ---

  if (ctx.fhirflyShlResult) {
    await runner.test("SHL.decode() — FhirflyStorage SHL", async () => {
      const decoded = SHL.decode(ctx.fhirflyShlResult!.url);

      if (!decoded.url) throw new Error("Missing manifest URL");
      if (!decoded.key || decoded.key.length !== 32) {
        throw new Error(`Key should be 32 bytes, got ${decoded.key?.length}`);
      }
      if (!decoded.flag) throw new Error("Missing flag");
      if (decoded.v !== 1) throw new Error(`Expected v=1, got ${decoded.v}`);
      if (decoded.label !== "Maria Garcia — Live Exercise") {
        throw new Error(`Label mismatch: "${decoded.label}"`);
      }

      runner.info(`url: ${decoded.url.slice(0, 60)}...`);
      runner.info(`flag: ${decoded.flag}, exp: ${decoded.exp}`);
    });

    // --- Decrypt FhirflyStorage round-trip ---

    await runner.test("SHL.decrypt() — FhirflyStorage round-trip", async () => {
      const decoded = SHL.decode(ctx.fhirflyShlResult!.url);

      // Fetch manifest
      const manifestRes = await fetch(decoded.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: ctx.fhirflyShlResult!.passcode }),
      });

      if (manifestRes.status !== 200) {
        throw new Error(`Manifest fetch failed: ${manifestRes.status}`);
      }

      const manifest = (await manifestRes.json()) as {
        files: Array<{ contentType: string; location: string }>;
      };

      const bundleFile = manifest.files.find(
        (f) => f.contentType === "application/fhir+json",
      );
      if (!bundleFile?.location) {
        throw new Error("No FHIR bundle file in manifest");
      }

      // Fetch and decrypt
      const contentRes = await fetch(bundleFile.location);
      const jwe = await contentRes.text();
      const decrypted = SHL.decrypt(jwe, decoded.key);

      if (decrypted.resourceType !== "Bundle") {
        throw new Error(`Expected Bundle, got ${decrypted.resourceType}`);
      }

      runner.info(`Decrypted: ${(decrypted.entry as unknown[])?.length} entries`);
    });

    // --- Verify patient data round-trip ---

    await runner.test("Round-trip — patient data preserved", async () => {
      const decoded = SHL.decode(ctx.fhirflyShlResult!.url);
      const manifestRes = await fetch(decoded.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: ctx.fhirflyShlResult!.passcode }),
      });
      const manifest = (await manifestRes.json()) as {
        files: Array<{ contentType: string; location: string }>;
      };
      const bundleFile = manifest.files.find(
        (f) => f.contentType === "application/fhir+json",
      )!;
      const jwe = await (await fetch(bundleFile.location)).text();
      const bundle = SHL.decrypt(jwe, decoded.key);

      // Find Patient resource
      const entries = bundle.entry as Array<{
        resource: Record<string, unknown>;
      }>;
      const patientEntry = entries.find(
        (e) => e.resource?.resourceType === "Patient",
      );
      if (!patientEntry) throw new Error("Patient resource not found");

      const patient = patientEntry.resource;
      const names = patient.name as Array<{ given?: string[]; family?: string }>;
      const name = names?.[0];

      if (!name?.given?.includes("Maria")) {
        throw new Error(`Expected given name "Maria", got ${JSON.stringify(name?.given)}`);
      }
      if (name?.family !== "Garcia") {
        throw new Error(`Expected family name "Garcia", got "${name?.family}"`);
      }
      if (patient.birthDate !== "1985-07-22") {
        throw new Error(`Expected birthDate "1985-07-22", got "${patient.birthDate}"`);
      }

      runner.info("Patient: Maria Garcia, 1985-07-22 — verified");
    });

    // --- Verify clinical data ---

    await runner.test("Round-trip — clinical resource types present", async () => {
      const decoded = SHL.decode(ctx.fhirflyShlResult!.url);
      const manifestRes = await fetch(decoded.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: ctx.fhirflyShlResult!.passcode }),
      });
      const manifest = (await manifestRes.json()) as {
        files: Array<{ contentType: string; location: string }>;
      };
      const bundleFile = manifest.files.find(
        (f) => f.contentType === "application/fhir+json",
      )!;
      const jwe = await (await fetch(bundleFile.location)).text();
      const bundle = SHL.decrypt(jwe, decoded.key);

      const entries = bundle.entry as Array<{
        resource: Record<string, unknown>;
      }>;
      const resourceTypes = new Set(
        entries.map((e) => e.resource?.resourceType as string),
      );

      const expectedTypes = [
        "Composition",
        "Patient",
        "MedicationStatement",
        "Condition",
        "AllergyIntolerance",
        "Immunization",
        "Observation",
      ];

      const missing = expectedTypes.filter((t) => !resourceTypes.has(t));
      if (missing.length > 0) {
        throw new Error(`Missing resource types: ${missing.join(", ")}`);
      }

      runner.info(`Resource types: ${[...resourceTypes].join(", ")}`);
    });

    // --- Verify Composition sections ---

    await runner.test("Round-trip — Composition sections", async () => {
      const decoded = SHL.decode(ctx.fhirflyShlResult!.url);
      const manifestRes = await fetch(decoded.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: ctx.fhirflyShlResult!.passcode }),
      });
      const manifest = (await manifestRes.json()) as {
        files: Array<{ contentType: string; location: string }>;
      };
      const bundleFile = manifest.files.find(
        (f) => f.contentType === "application/fhir+json",
      )!;
      const jwe = await (await fetch(bundleFile.location)).text();
      const bundle = SHL.decrypt(jwe, decoded.key);

      const entries = bundle.entry as Array<{
        resource: Record<string, unknown>;
      }>;
      const composition = entries.find(
        (e) => e.resource?.resourceType === "Composition",
      );
      if (!composition) throw new Error("Composition not found");

      const sections = composition.resource.section as Array<{
        title?: string;
      }>;
      if (!sections || sections.length === 0) {
        throw new Error("Composition has no sections");
      }

      const titles = sections.map((s) => s.title).filter(Boolean);
      runner.info(`Composition sections: ${titles.join(", ")}`);

      // Should have at least medications, allergies, conditions
      if (sections.length < 3) {
        throw new Error(`Expected >= 3 sections, got ${sections.length}`);
      }
    });
  } else {
    runner.skip("FhirflyStorage decode/decrypt tests", "Section 2 did not create an SHL");
  }

  // --- Decode LocalStorage SHL (if available) ---

  if (ctx.localShlResult) {
    await runner.test("SHL.decode() — LocalStorage SHL", async () => {
      const decoded = SHL.decode(ctx.localShlResult!.url);

      if (!decoded.url) throw new Error("Missing manifest URL");
      if (!decoded.key || decoded.key.length !== 32) {
        throw new Error(`Key should be 32 bytes, got ${decoded.key?.length}`);
      }
      if (decoded.label !== "Local Exercise SHL") {
        throw new Error(`Label mismatch: "${decoded.label}"`);
      }

      runner.info(`Local SHL manifest URL: ${decoded.url}`);
    });
  } else {
    runner.skip("SHL.decode() — LocalStorage SHL", "Section 3 did not create an SHL");
  }

  // --- Viewer URL (info only) ---

  if (ctx.fhirflyShlResult) {
    await runner.test("Viewer URL", async () => {
      const viewerUrl = `https://preview.fhirfly.io/shl/viewer#${ctx.fhirflyShlResult!.url}`;
      runner.info(`Viewer: ${viewerUrl}`, true);
      // Always passes — informational only
    });
  }
}
