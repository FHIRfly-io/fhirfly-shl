#!/usr/bin/env node
// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
/**
 * CLI entry point for @fhirfly-io/shl.
 *
 * Usage: npx @fhirfly-io/shl <command> [options]
 */

import { Command } from "commander";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { registerValidateCommand } from "./validate.js";
import { registerCreateCommand } from "./create.js";
import { registerDecodeCommand } from "./decode.js";
import { registerServeCommand } from "./serve.js";
import { registerDemoCommand } from "./demo.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getVersion(): string {
  try {
    // In dist/, go up one level to find package.json
    const pkgPath = resolve(__dirname, "..", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version: string };
    return pkg.version;
  } catch {
    return "0.0.0";
  }
}

const program = new Command();

program
  .name("fhirfly-shl")
  .description("CLI tools for SMART Health Links — build, validate, encrypt, and share IPS bundles")
  .version(getVersion());

registerValidateCommand(program);
registerCreateCommand(program);
registerDecodeCommand(program);
registerServeCommand(program);
registerDemoCommand(program);

program.parse();
