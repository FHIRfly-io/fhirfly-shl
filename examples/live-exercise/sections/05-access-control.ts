// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Section 5: Access Control & Lifecycle
 *
 * Creates dedicated SHLs to test passcode validation, access count limits,
 * expiration, and revocation. All SHLs are revoked within this section.
 */

import { SHL } from "../../../src/index.js";
import type { ExerciseContext } from "../lib/types.js";

/** Helper to create a dedicated SHL for a specific access control test. */
async function createTestShl(
  ctx: ExerciseContext,
  options: Partial<SHL.SHLOptions>,
): Promise<SHL.SHLResult> {
  if (!ctx.fhirBundle || !ctx.fhirflyStorage) {
    throw new Error("Requires fhirBundle and fhirflyStorage from earlier sections");
  }

  const result = await SHL.create({
    bundle: ctx.fhirBundle,
    storage: ctx.fhirflyStorage,
    ...options,
  });

  ctx.createdShlIds.push({ id: result.id, storage: ctx.fhirflyStorage });
  return result;
}

/** Helper to POST to manifest endpoint. */
async function fetchManifest(
  url: string,
  passcode?: string,
): Promise<Response> {
  const body: Record<string, unknown> = {};
  if (passcode !== undefined) {
    body.passcode = passcode;
  }
  return fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export async function runAccessControl(ctx: ExerciseContext): Promise<void> {
  const { runner } = ctx;
  runner.section("Section 5: Access Control & Lifecycle");

  if (!ctx.fhirBundle || !ctx.fhirflyStorage) {
    runner.skip("All access control tests", "Requires sections 1 + 2");
    return;
  }

  // --- Passcode tests ---

  let passcodeResult: SHL.SHLResult | undefined;

  await runner.test("Passcode — correct passcode returns 200", async () => {
    passcodeResult = await createTestShl(ctx, {
      passcode: "secret42",
      label: "Passcode test",
    });

    const decoded = SHL.decode(passcodeResult.url);
    const res = await fetchManifest(decoded.url, "secret42");

    if (res.status !== 200) {
      throw new Error(`Expected 200, got ${res.status}`);
    }
  });

  await runner.test("Passcode — wrong passcode returns 401", async () => {
    if (!passcodeResult) throw new Error("No SHL from previous test");

    const decoded = SHL.decode(passcodeResult.url);
    const res = await fetchManifest(decoded.url, "wrongpasscode");

    if (res.status !== 401) {
      throw new Error(`Expected 401, got ${res.status}`);
    }
  });

  await runner.test("Passcode — missing passcode returns 401", async () => {
    if (!passcodeResult) throw new Error("No SHL from previous test");

    const decoded = SHL.decode(passcodeResult.url);
    // POST with empty body (no passcode field)
    const res = await fetch(decoded.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    if (res.status !== 401) {
      throw new Error(`Expected 401, got ${res.status}`);
    }
  });

  // --- Access count tests ---

  await runner.test("Access count — within limit returns 200", async () => {
    const result = await createTestShl(ctx, {
      maxAccesses: 3,
      label: "Access count test",
    });

    const decoded = SHL.decode(result.url);

    // Access 3 times — all should succeed
    for (let i = 1; i <= 3; i++) {
      const res = await fetchManifest(decoded.url);
      if (res.status !== 200) {
        throw new Error(`Access ${i}/3: expected 200, got ${res.status}`);
      }
    }
  });

  await runner.test("Access count — exceeds limit returns 410", async () => {
    const result = await createTestShl(ctx, {
      maxAccesses: 2,
      label: "Access limit test",
    });

    const decoded = SHL.decode(result.url);

    // Use up all accesses
    for (let i = 1; i <= 2; i++) {
      await fetchManifest(decoded.url);
    }

    // 3rd access should fail
    const res = await fetchManifest(decoded.url);
    if (res.status !== 410) {
      throw new Error(`Expected 410 (Gone), got ${res.status}`);
    }
  });

  // --- Expiration tests ---

  await runner.test("Expiration — not expired returns 200", async () => {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + 1);

    const result = await createTestShl(ctx, {
      expiresAt,
      label: "Not expired test",
    });

    const decoded = SHL.decode(result.url);
    const res = await fetchManifest(decoded.url);

    if (res.status !== 200) {
      throw new Error(`Expected 200, got ${res.status}`);
    }
  });

  await runner.test("Expiration — already expired returns 410", async () => {
    // Create with expiration in the past
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() - 1);

    const result = await createTestShl(ctx, {
      expiresAt,
      label: "Expired test",
    });

    const decoded = SHL.decode(result.url);
    const res = await fetchManifest(decoded.url);

    if (res.status !== 410) {
      throw new Error(`Expected 410 (Gone), got ${res.status}`);
    }
  });

  // --- Revocation tests ---

  await runner.test("SHL.revoke() — access returns 404 after revoke", async () => {
    const result = await createTestShl(ctx, {
      label: "Revoke test",
    });

    const decoded = SHL.decode(result.url);

    // Verify it works first
    const resBefore = await fetchManifest(decoded.url);
    if (resBefore.status !== 200) {
      throw new Error(`Pre-revoke: expected 200, got ${resBefore.status}`);
    }

    // Revoke
    await SHL.revoke(result.id, ctx.fhirflyStorage!);

    // Should now return 404
    const resAfter = await fetchManifest(decoded.url);
    if (resAfter.status !== 404) {
      throw new Error(`Post-revoke: expected 404, got ${resAfter.status}`);
    }

    // Remove from cleanup list (already revoked)
    ctx.createdShlIds = ctx.createdShlIds.filter((s) => s.id !== result.id);
  });

  await runner.test("SHL.revoke() — idempotent (second revoke no error)", async () => {
    const result = await createTestShl(ctx, {
      label: "Revoke idempotent test",
    });

    // Revoke twice
    await SHL.revoke(result.id, ctx.fhirflyStorage!);
    await SHL.revoke(result.id, ctx.fhirflyStorage!); // Should not throw

    // Remove from cleanup list
    ctx.createdShlIds = ctx.createdShlIds.filter((s) => s.id !== result.id);
  });
}
