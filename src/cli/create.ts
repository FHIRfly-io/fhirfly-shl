// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import type { Command } from "commander";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { SHL } from "../index.js";

export function registerCreateCommand(program: Command): void {
  program
    .command("create <bundle.json>")
    .description("Create a SMART Health Link from a FHIR Bundle JSON file")
    .option("--passcode <code>", "Passcode to protect the SHL")
    .option("--exp <duration>", "Expiration (e.g., 24h, 7d, 30d)")
    .option("--label <text>", "Label for the SHL (shown in viewer apps)")
    .option("--dir <path>", "Storage directory for SHL files", "./shl-data")
    .option("--base-url <url>", "Base URL for serving SHLs", "http://localhost:3456/shl")
    .option("--output <dir>", "Directory to save QR code PNG")
    .option("--json", "Output result as JSON")
    .action(async (file: string, opts: {
      passcode?: string;
      exp?: string;
      label?: string;
      dir: string;
      baseUrl: string;
      output?: string;
      json?: boolean;
    }) => {
      try {
        const content = readFileSync(file, "utf8");
        const bundle = JSON.parse(content) as Record<string, unknown>;

        const storage = new SHL.LocalStorage({
          directory: resolve(opts.dir),
          baseUrl: opts.baseUrl,
        });

        const shlOptions: Parameters<typeof SHL.create>[0] = {
          bundle,
          storage,
          passcode: opts.passcode,
          label: opts.label,
        };

        if (opts.exp) {
          shlOptions.expiresAt = parseExpiration(opts.exp);
        }

        const result = await SHL.create(shlOptions);

        if (opts.output) {
          // Save QR code as PNG file
          const qrDir = resolve(opts.output);
          mkdirSync(qrDir, { recursive: true });
          const qrPath = resolve(qrDir, `${result.id}.png`);
          const base64Data = result.qrCode.replace(/^data:image\/png;base64,/, "");
          writeFileSync(qrPath, Buffer.from(base64Data, "base64"));
        }

        if (opts.json) {
          console.log(JSON.stringify({
            url: result.url,
            id: result.id,
            qrCode: result.qrCode,
            passcode: result.passcode,
            expiresAt: result.expiresAt?.toISOString(),
          }, null, 2));
        } else {
          console.log(`\x1b[32m✓ SHL created\x1b[0m`);
          console.log(`  ID:  ${result.id}`);
          console.log(`  URL: ${result.url}`);
          if (result.passcode) {
            console.log(`  Passcode: ${result.passcode}`);
          }
          if (result.expiresAt) {
            console.log(`  Expires: ${result.expiresAt.toISOString()}`);
          }
          if (opts.output) {
            console.log(`  QR:  ${resolve(opts.output, `${result.id}.png`)}`);
          }
          console.log(`\n  Files stored in: ${resolve(opts.dir)}`);
          console.log(`  Serve with: fhirfly-shl serve --dir ${opts.dir}`);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      }
    });
}

function parseExpiration(exp: string): Date {
  const match = exp.match(/^(\d+)(h|d|m)$/);
  if (!match) {
    throw new Error(`Invalid expiration format: "${exp}". Use formats like 24h, 7d, 30d`);
  }
  const [, numStr, unit] = match;
  const num = parseInt(numStr!, 10);
  const now = new Date();

  switch (unit) {
    case "h":
      return new Date(now.getTime() + num * 60 * 60 * 1000);
    case "d":
      return new Date(now.getTime() + num * 24 * 60 * 60 * 1000);
    case "m":
      return new Date(now.getTime() + num * 30 * 24 * 60 * 60 * 1000);
    default:
      throw new Error(`Unknown time unit: "${unit!}"`);
  }
}
