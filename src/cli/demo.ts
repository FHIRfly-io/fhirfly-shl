// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import type { Command } from "commander";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { IPS, SHL } from "../index.js";
import { createHandler } from "../server/handler.js";
import { ServerLocalStorage } from "../server/storage.js";
import { createServer } from "node:http";

export function registerDemoCommand(program: Command): void {
  program
    .command("demo")
    .description("Full round-trip demo: build IPS → encrypt → serve → print QR code URL")
    .option("--port <port>", "Port for the demo server", "3456")
    .option("--no-serve", "Skip starting a server (just create the SHL)")
    .action(async (opts: { port: string; serve: boolean }) => {
      try {
        const port = parseInt(opts.port, 10);
        const tempDir = mkdtempSync(join(tmpdir(), "fhirfly-shl-demo-"));
        const baseUrl = `http://localhost:${port}/shl`;

        console.log("Building IPS Bundle...");

        // Build a sample IPS bundle with manual coding (no API dependency)
        const bundle = new IPS.Bundle({
          given: "Maria",
          family: "Garcia",
          birthDate: "1985-03-15",
          gender: "female",
        });

        bundle
          .addMedication({
            code: "860975",
            system: "http://www.nlm.nih.gov/research/umls/rxnorm",
            display: "Metformin hydrochloride 500 MG Oral Tablet",
            status: "active",
            dosageText: "500mg twice daily",
          })
          .addCondition({
            code: "E11.9",
            system: "http://hl7.org/fhir/sid/icd-10-cm",
            display: "Type 2 diabetes mellitus without complications",
            clinicalStatus: "active",
            onsetDate: "2020-06-01",
          })
          .addAllergy({
            code: "91936005",
            system: "http://snomed.info/sct",
            display: "Penicillin allergy",
            clinicalStatus: "active",
            criticality: "high",
          })
          .addImmunization({
            code: "207",
            system: "http://hl7.org/fhir/sid/cvx",
            display: "COVID-19, mRNA, LNP-S, PF, 30 mcg/0.3 mL dose",
            status: "completed",
            occurrenceDate: "2024-09-15",
          })
          .addResult({
            code: "4548-4",
            system: "http://loinc.org",
            display: "Hemoglobin A1c/Hemoglobin.total in Blood",
            value: 6.8,
            unit: "%",
            effectiveDate: "2026-01-10",
          });

        const fhirBundle = await bundle.build({ profile: "ips" });

        console.log(`  ✓ Bundle built (${(fhirBundle.entry as unknown[]).length} entries)`);

        // Create SHL
        const storage = new SHL.LocalStorage({
          directory: tempDir,
          baseUrl,
        });

        const result = await SHL.create({
          bundle: fhirBundle,
          storage,
          label: "Maria Garcia — Patient Summary",
          passcode: "1234",
        });

        console.log(`  ✓ SHL created`);
        console.log(`  ID: ${result.id}`);
        console.log(`  Passcode: ${result.passcode!}`);
        console.log(`  URL: ${result.url}`);
        console.log(`  Files stored in: ${tempDir}`);

        if (!opts.serve) {
          console.log(`\nDone! Start a server with:`);
          console.log(`  fhirfly-shl serve --dir ${tempDir} --port ${port}`);
          return;
        }

        // Start demo server
        const serverStorage = new ServerLocalStorage({
          directory: tempDir,
          baseUrl,
        });

        const handler = createHandler({
          storage: serverStorage,
          onAccess: (event) => {
            console.log(`  [Access] ${event.shlId} (count: ${event.accessCount})`);
          },
        });

        const server = createServer(async (req, res) => {
          const url = new URL(req.url ?? "/", `http://localhost:${port}`);
          const path = url.pathname;

          if (!path.startsWith("/shl")) {
            res.writeHead(404);
            res.end("Not found");
            return;
          }

          const shlPath = path.slice(4);
          let body: unknown;
          if (req.method === "POST") {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
            }
            try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { body = undefined; }
          }

          const headers: Record<string, string | undefined> = {};
          for (const [key, value] of Object.entries(req.headers)) {
            headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
          }

          const response = await handler({ method: req.method ?? "GET", path: shlPath, body, headers });
          res.writeHead(response.status, response.headers);
          res.end(response.body instanceof Uint8Array ? Buffer.from(response.body) : response.body);
        });

        server.listen(port, () => {
          console.log(`\n\x1b[32m✓ Demo server running on port ${port}\x1b[0m`);
          console.log(`\nTest commands:`);
          console.log(`  # Fetch manifest (with passcode)`);
          console.log(`  curl -s -X POST ${baseUrl}/${result.id} -H "Content-Type: application/json" -d '{"passcode":"1234"}' | jq .`);
          console.log(`\n  # Download encrypted content`);
          console.log(`  curl -s ${baseUrl}/${result.id}/content`);
          console.log(`\n  # Decode the SHL URL`);
          console.log(`  fhirfly-shl decode "${result.url}"`);
          console.log(`\nPress Ctrl+C to stop`);
        });
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
