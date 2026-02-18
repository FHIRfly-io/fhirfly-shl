// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.

/**
 * Section 3: LocalStorage + Express Server
 *
 * Creates an SHL using local filesystem storage, spins up an Express server
 * to serve it, and verifies the full request flow including decryption.
 *
 * Skips gracefully if express is not installed.
 */

import { mkdtempSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SHL } from "../../../src/index.js";
import { ServerLocalStorage } from "../../../src/server/index.js";
import type { ExerciseContext } from "../lib/types.js";

export async function runLocalStorage(ctx: ExerciseContext): Promise<void> {
  const { runner } = ctx;
  runner.section("Section 3: LocalStorage + Express Server");

  if (!ctx.fhirBundle) {
    runner.skip("All LocalStorage tests", "Section 1 did not produce a FHIR bundle");
    return;
  }

  // Check if express is available
  let express: typeof import("express") | undefined;
  let expressMiddleware: typeof import("../../../src/adapters/express.js").expressMiddleware | undefined;
  try {
    express = await import("express");
    const adapterModule = await import("../../../src/adapters/express.js");
    expressMiddleware = adapterModule.expressMiddleware;
  } catch {
    runner.skip("All LocalStorage tests", "express not installed (npm i -D express)");
    return;
  }

  const tmpDir = mkdtempSync(join(tmpdir(), "shl-exercise-"));
  let server: ReturnType<ReturnType<typeof express.default>["listen"]> | undefined;
  let port = 0;
  let shlResult: SHL.SHLResult | undefined;
  let storage: ServerLocalStorage | undefined;

  try {
    // --- Create SHL with LocalStorage ---

    await runner.test("LocalStorage + SHL.create()", async () => {
      // We'll assign the port once the server starts, but need a placeholder baseUrl.
      // We'll use port 0 and let the OS pick, then update afterward.
      // For now, create with a temporary baseUrl and rely on the fact that
      // the SHL URL embeds the baseUrl at creation time.

      // Start server first to get the port
      const app = express!.default();
      app.use(express!.default.json());

      storage = new ServerLocalStorage({
        directory: tmpDir,
        baseUrl: "http://placeholder",
      });

      // Listen on port 0 to get a random available port
      server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
        const s = app.listen(0, () => resolve(s));
      });

      const addr = server.address();
      if (!addr || typeof addr === "string") {
        throw new Error("Could not determine server port");
      }
      port = addr.port;

      // Re-create storage with actual baseUrl
      storage = new ServerLocalStorage({
        directory: tmpDir,
        baseUrl: `http://127.0.0.1:${port}/shl`,
      });

      // Mount middleware
      app.use("/shl", expressMiddleware!({ storage }));

      // Create the SHL
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 1);

      shlResult = await SHL.create({
        bundle: ctx.fhirBundle!,
        storage,
        passcode: "local1234",
        label: "Local Exercise SHL",
        expiresAt,
      });

      // Verify files exist on disk
      const shlDir = join(tmpDir, shlResult.id);
      for (const file of ["content.jwe", "manifest.json", "metadata.json"]) {
        if (!existsSync(join(shlDir, file))) {
          throw new Error(`Missing file: ${shlDir}/${file}`);
        }
      }

      ctx.localShlResult = shlResult;
      runner.info(`Files stored in: ${shlDir}`, true);
      runner.info(`Server on port ${port}`, true);
    });

    if (!shlResult || !server) return;

    // --- POST manifest ---

    await runner.test("POST /{shlId} returns manifest", async () => {
      const url = `http://127.0.0.1:${port}/shl/${shlResult!.id}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: "local1234" }),
      });

      if (response.status !== 200) {
        const text = await response.text().catch(() => "");
        throw new Error(`Expected 200, got ${response.status}: ${text}`);
      }

      const manifest = (await response.json()) as { files?: Array<{ contentType?: string }> };
      if (!manifest.files || manifest.files.length === 0) {
        throw new Error("Manifest has no files");
      }

      runner.info(`Manifest files: ${manifest.files.length}`);
    });

    // --- GET content ---

    await runner.test("GET /{shlId}/content returns JWE", async () => {
      const url = `http://127.0.0.1:${port}/shl/${shlResult!.id}/content`;
      const response = await fetch(url);

      if (response.status !== 200) {
        throw new Error(`Expected 200, got ${response.status}`);
      }

      const jwe = await response.text();
      const parts = jwe.split(".");
      if (parts.length !== 5) {
        throw new Error(`JWE should have 5 parts, got ${parts.length}`);
      }

      runner.info(`JWE length: ${jwe.length} chars`);
    });

    // --- Decrypt round-trip ---

    await runner.test("SHL.decrypt() round-trip", async () => {
      const decoded = SHL.decode(shlResult!.url);

      // Fetch manifest
      const manifestRes = await fetch(decoded.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: "local1234" }),
      });
      const manifest = (await manifestRes.json()) as {
        files: Array<{ contentType: string; location: string }>;
      };

      // Find the FHIR bundle file
      const bundleFile = manifest.files.find(
        (f) => f.contentType === "application/fhir+json",
      );
      if (!bundleFile?.location) {
        throw new Error("No FHIR bundle file in manifest");
      }

      // Fetch the encrypted content
      const contentRes = await fetch(bundleFile.location);
      const jwe = await contentRes.text();

      // Decrypt
      const decrypted = SHL.decrypt(jwe, decoded.key);

      if (decrypted.resourceType !== "Bundle") {
        throw new Error(`Expected Bundle, got ${decrypted.resourceType}`);
      }

      const originalEntries = (ctx.fhirBundle!.entry as unknown[])?.length ?? 0;
      const decryptedEntries = (decrypted.entry as unknown[])?.length ?? 0;
      if (decryptedEntries !== originalEntries) {
        throw new Error(
          `Entry count mismatch: original ${originalEntries}, decrypted ${decryptedEntries}`,
        );
      }

      runner.info(`Decrypted bundle: ${decryptedEntries} entries`);
    });

    // --- Wrong passcode ---

    await runner.test("Wrong passcode returns 401", async () => {
      const url = `http://127.0.0.1:${port}/shl/${shlResult!.id}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode: "wrongpass" }),
      });

      if (response.status !== 401) {
        throw new Error(`Expected 401, got ${response.status}`);
      }
    });
  } finally {
    // --- Cleanup ---

    if (server) {
      await runner.test("Server shutdown + cleanup", async () => {
        await new Promise<void>((resolve, reject) => {
          server!.close((err: Error | undefined) => (err ? reject(err) : resolve()));
        });
        rmSync(tmpDir, { recursive: true, force: true });
        runner.info("Server stopped, temp dir removed");
      });
    } else {
      // Clean up tmpDir even if server never started
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}
