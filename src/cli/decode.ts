// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import type { Command } from "commander";
import { SHL } from "../index.js";

export function registerDecodeCommand(program: Command): void {
  program
    .command("decode <shlink-url>")
    .description("Decode a shlink:/ URL and display its components")
    .option("--fetch", "Fetch the manifest and display content metadata")
    .option("--decrypt", "Decrypt and pretty-print the FHIR Bundle")
    .option("--passcode <code>", "Passcode for protected SHLs")
    .option("--json", "Output as JSON")
    .action(async (url: string, opts: { fetch?: boolean; decrypt?: boolean; passcode?: string; json?: boolean }) => {
      try {
        const decoded = SHL.decode(url);

        if (opts.json && !opts.fetch && !opts.decrypt) {
          console.log(JSON.stringify({
            manifestUrl: decoded.url,
            flags: decoded.flag,
            version: decoded.v,
            label: decoded.label,
            expiration: decoded.exp,
            keyLength: decoded.key.length,
          }, null, 2));
          return;
        }

        if (!opts.fetch && !opts.decrypt) {
          console.log(`\x1b[32m✓ Decoded SHL\x1b[0m`);
          console.log(`  Manifest URL: ${decoded.url}`);
          console.log(`  Flags: ${decoded.flag}`);
          console.log(`  Version: ${decoded.v ?? 1}`);
          if (decoded.label) console.log(`  Label: ${decoded.label}`);
          if (decoded.exp) console.log(`  Expires: ${new Date(decoded.exp * 1000).toISOString()}`);
          console.log(`  Key: ${decoded.key.length} bytes`);
          console.log(`  Passcode required: ${decoded.flag.includes("P") ? "yes" : "no"}`);
          return;
        }

        // Fetch manifest
        const body: Record<string, unknown> = {};
        if (opts.passcode) {
          body.passcode = opts.passcode;
        }

        const response = await fetch(decoded.url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const text = await response.text();
          console.error(`Manifest fetch failed (${response.status}): ${text}`);
          process.exit(1);
        }

        const manifest = await response.json() as { files: Array<{ contentType: string; location?: string }> };

        if (opts.json && !opts.decrypt) {
          console.log(JSON.stringify({
            manifestUrl: decoded.url,
            flags: decoded.flag,
            manifest,
          }, null, 2));
          return;
        }

        if (!opts.decrypt) {
          console.log(`\x1b[32m✓ Manifest fetched\x1b[0m`);
          console.log(`  Files: ${manifest.files.length}`);
          for (const f of manifest.files) {
            console.log(`  • ${f.contentType}${f.location ? ` → ${f.location}` : ""}`);
          }
          return;
        }

        // Decrypt the FHIR bundle
        const fhirEntry = manifest.files.find((f) => f.contentType === "application/fhir+json");
        if (!fhirEntry?.location) {
          console.error("No FHIR bundle entry found in manifest");
          process.exit(1);
        }

        const contentResponse = await fetch(fhirEntry.location);
        if (!contentResponse.ok) {
          console.error(`Content fetch failed (${contentResponse.status})`);
          process.exit(1);
        }

        const jwe = await contentResponse.text();
        const bundle = SHL.decrypt(jwe, decoded.key);

        if (opts.json) {
          console.log(JSON.stringify(bundle, null, 2));
        } else {
          console.log(`\x1b[32m✓ Decrypted FHIR Bundle\x1b[0m`);
          console.log(JSON.stringify(bundle, null, 2));
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}
