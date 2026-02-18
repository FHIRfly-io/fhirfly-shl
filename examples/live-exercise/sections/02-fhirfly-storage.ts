// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Section 2: FhirflyStorage (zero-infra path)
 *
 * Creates an SHL using FHIRfly's hosted storage and verifies the result.
 */

import { SHL } from "../../../src/index.js";
import type { ExerciseContext } from "../lib/types.js";

export async function runFhirflyStorage(ctx: ExerciseContext): Promise<void> {
  const { runner, apiKey, apiBaseUrl } = ctx;
  runner.section("Section 2: FhirflyStorage (Zero-Infra)");

  if (!ctx.fhirBundle) {
    runner.skip("All FhirflyStorage tests", "Section 1 did not produce a FHIR bundle");
    return;
  }

  let storage: SHL.FhirflyStorage | undefined;

  // --- Instantiation ---

  await runner.test("FhirflyStorage instantiation", async () => {
    storage = new SHL.FhirflyStorage({ apiKey, apiBaseUrl });
    if (!storage.baseUrl.includes("/public/shl")) {
      throw new Error(`Unexpected baseUrl: ${storage.baseUrl}`);
    }
    runner.info(`baseUrl: ${storage.baseUrl}`);
  });

  if (!storage) return;
  ctx.fhirflyStorage = storage;

  // --- SHL.create() ---

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  await runner.test("SHL.create() with FhirflyStorage", async () => {
    const result = await SHL.create({
      bundle: ctx.fhirBundle!,
      storage: storage!,
      passcode: "test1234",
      label: "Maria Garcia — Live Exercise",
      expiresAt,
    });

    if (!result.url.startsWith("shlink:/")) {
      throw new Error(`URL should start with shlink:/, got: ${result.url.slice(0, 30)}`);
    }
    if (!result.id || result.id.length < 20) {
      throw new Error(`SHL ID seems invalid: "${result.id}"`);
    }
    if (result.passcode !== "test1234") {
      throw new Error(`Passcode mismatch: "${result.passcode}"`);
    }

    ctx.fhirflyShlResult = result;
    ctx.createdShlIds.push({ id: result.id, storage: storage! });

    runner.info(`SHL ID: ${result.id}`, true);
    runner.info(`URL: ${result.url.slice(0, 60)}...`, true);
  });

  if (!ctx.fhirflyShlResult) return;

  // --- QR code ---

  await runner.test("QR code generated", async () => {
    const qr = ctx.fhirflyShlResult!.qrCode;
    if (!qr.startsWith("data:image/png;base64,")) {
      throw new Error(`QR code should be a PNG data URI, starts with: ${qr.slice(0, 30)}`);
    }
    const base64Part = qr.split(",")[1]!;
    if (base64Part.length < 100) {
      throw new Error(`QR code base64 seems too small: ${base64Part.length} chars`);
    }
    runner.info(`QR code size: ${base64Part.length} base64 chars`);
  });

  // --- Decode the SHL URL ---

  await runner.test("SHL URL is decodable", async () => {
    const decoded = SHL.decode(ctx.fhirflyShlResult!.url);

    if (!decoded.url || !decoded.url.startsWith("http")) {
      throw new Error(`Decoded URL should be HTTP(S): ${decoded.url}`);
    }
    if (!decoded.key || decoded.key.length !== 32) {
      throw new Error(`Key should be 32 bytes, got ${decoded.key?.length}`);
    }
    if (!decoded.flag.includes("P")) {
      throw new Error(`Flag should include "P" (passcode), got "${decoded.flag}"`);
    }
    if (decoded.label !== "Maria Garcia — Live Exercise") {
      throw new Error(`Label mismatch: "${decoded.label}"`);
    }

    runner.info(`Manifest URL: ${decoded.url}`);
    runner.info(`Flag: ${decoded.flag}, v: ${decoded.v}`);
  });

  // --- Verify content accessible via API ---

  await runner.test("Content accessible via FHIRfly API", async () => {
    const decoded = SHL.decode(ctx.fhirflyShlResult!.url);

    // POST to manifest URL with passcode
    const response = await fetch(decoded.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ passcode: "test1234" }),
    });

    if (response.status !== 200) {
      const text = await response.text().catch(() => "");
      throw new Error(`Expected 200, got ${response.status}: ${text}`);
    }

    const manifest = (await response.json()) as { files?: Array<{ contentType?: string; location?: string }> };
    if (!manifest.files || manifest.files.length === 0) {
      throw new Error("Manifest has no files");
    }

    runner.info(`Manifest files: ${manifest.files.length}`);
    for (const file of manifest.files) {
      runner.info(`  ${file.contentType} → ${file.location?.slice(0, 60)}...`);
    }
  });
}
