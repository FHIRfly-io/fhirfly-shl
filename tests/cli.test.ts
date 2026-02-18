// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const CLI = join(import.meta.dirname, "..", "dist", "cli.js");

function run(args: string[], opts?: { cwd?: string }): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync("node", [CLI, ...args], {
      encoding: "utf8",
      timeout: 30000,
      cwd: opts?.cwd,
    });
    return { stdout, exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { stdout: (e.stdout ?? "") + (e.stderr ?? ""), exitCode: e.status ?? 1 };
  }
}

// ---------------------------------------------------------------------------
// --help and --version
// ---------------------------------------------------------------------------

describe("CLI basics", () => {
  it("shows help", () => {
    const { stdout, exitCode } = run(["--help"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("fhirfly-shl");
    expect(stdout).toContain("validate");
    expect(stdout).toContain("create");
    expect(stdout).toContain("decode");
    expect(stdout).toContain("serve");
    expect(stdout).toContain("demo");
  });

  it("shows version", () => {
    const { stdout, exitCode } = run(["--version"]);
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });
});

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

describe("CLI validate", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cli-validate-"));
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("validates a valid IPS bundle", () => {
    const bundle = {
      resourceType: "Bundle",
      type: "document",
      entry: [
        { resource: { resourceType: "Composition" } },
        { resource: { resourceType: "Patient" } },
      ],
    };
    const file = join(tempDir, "valid.json");
    writeFileSync(file, JSON.stringify(bundle));

    const { stdout, exitCode } = run(["validate", file]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Valid");
  });

  it("reports errors for invalid bundle", () => {
    const bundle = { resourceType: "Patient" };
    const file = join(tempDir, "invalid.json");
    writeFileSync(file, JSON.stringify(bundle));

    const { stdout, exitCode } = run(["validate", file]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain("error");
  });

  it("supports --json output", () => {
    const bundle = {
      resourceType: "Bundle",
      type: "document",
      entry: [
        { resource: { resourceType: "Composition" } },
        { resource: { resourceType: "Patient" } },
      ],
    };
    const file = join(tempDir, "json-out.json");
    writeFileSync(file, JSON.stringify(bundle));

    const { stdout, exitCode } = run(["validate", "--json", file]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout) as { valid: boolean; issues: unknown[] };
    expect(result.valid).toBe(true);
  });

  it("reports missing file", () => {
    const { exitCode } = run(["validate", "/nonexistent/file.json"]);
    expect(exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe("CLI create", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cli-create-"));
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates an SHL from a bundle file", () => {
    const bundle = {
      resourceType: "Bundle",
      type: "document",
      entry: [{ resource: { resourceType: "Patient" } }],
    };
    const bundleFile = join(tempDir, "bundle.json");
    writeFileSync(bundleFile, JSON.stringify(bundle));
    const shlDir = join(tempDir, "shl-out");

    const { stdout, exitCode } = run(["create", bundleFile, "--dir", shlDir]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("SHL created");
    expect(stdout).toContain("URL:");
  });

  it("supports --json output", () => {
    const bundle = {
      resourceType: "Bundle",
      type: "document",
      entry: [{ resource: { resourceType: "Patient" } }],
    };
    const bundleFile = join(tempDir, "bundle-json.json");
    writeFileSync(bundleFile, JSON.stringify(bundle));
    const shlDir = join(tempDir, "shl-json");

    const { stdout, exitCode } = run(["create", bundleFile, "--dir", shlDir, "--json"]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout) as { url: string; id: string };
    expect(result.url).toMatch(/^shlink:\//);
    expect(result.id).toBeTruthy();
  });

  it("supports --passcode", () => {
    const bundle = {
      resourceType: "Bundle",
      type: "document",
      entry: [{ resource: { resourceType: "Patient" } }],
    };
    const bundleFile = join(tempDir, "bundle-pc.json");
    writeFileSync(bundleFile, JSON.stringify(bundle));
    const shlDir = join(tempDir, "shl-pc");

    const { stdout, exitCode } = run(["create", bundleFile, "--dir", shlDir, "--passcode", "1234", "--json"]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout) as { passcode: string };
    expect(result.passcode).toBe("1234");
  });

  it("saves QR code with --output", () => {
    const bundle = {
      resourceType: "Bundle",
      type: "document",
      entry: [{ resource: { resourceType: "Patient" } }],
    };
    const bundleFile = join(tempDir, "bundle-qr.json");
    writeFileSync(bundleFile, JSON.stringify(bundle));
    const shlDir = join(tempDir, "shl-qr");
    const qrDir = join(tempDir, "qr-out");

    const { stdout, exitCode } = run(["create", bundleFile, "--dir", shlDir, "--output", qrDir, "--json"]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout) as { id: string };
    const qrFile = join(qrDir, `${result.id}.png`);
    const qrContent = readFileSync(qrFile);
    // PNG magic bytes
    expect(qrContent[0]).toBe(0x89);
    expect(qrContent[1]).toBe(0x50);
  });
});

// ---------------------------------------------------------------------------
// decode
// ---------------------------------------------------------------------------

describe("CLI decode", () => {
  it("decodes a shlink:/ URL", () => {
    // Create a valid shlink URL first
    const tempDir = mkdtempSync(join(tmpdir(), "cli-decode-"));
    const bundle = { resourceType: "Bundle", type: "document", entry: [] };
    const bundleFile = join(tempDir, "bundle.json");
    writeFileSync(bundleFile, JSON.stringify(bundle));
    const shlDir = join(tempDir, "shl");

    const createResult = run(["create", bundleFile, "--dir", shlDir, "--json"]);
    const { url } = JSON.parse(createResult.stdout) as { url: string };

    const { stdout, exitCode } = run(["decode", url]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Decoded SHL");
    expect(stdout).toContain("Manifest URL");
    expect(stdout).toContain("Flags");

    rmSync(tempDir, { recursive: true, force: true });
  });

  it("supports --json output", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "cli-decode-json-"));
    const bundle = { resourceType: "Bundle", type: "document", entry: [] };
    const bundleFile = join(tempDir, "bundle.json");
    writeFileSync(bundleFile, JSON.stringify(bundle));
    const shlDir = join(tempDir, "shl");

    const createResult = run(["create", bundleFile, "--dir", shlDir, "--json"]);
    const { url } = JSON.parse(createResult.stdout) as { url: string };

    const { stdout, exitCode } = run(["decode", url, "--json"]);
    expect(exitCode).toBe(0);
    const result = JSON.parse(stdout) as { manifestUrl: string; flags: string };
    expect(result.manifestUrl).toBeTruthy();
    expect(result.flags).toBeTruthy();

    rmSync(tempDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// demo
// ---------------------------------------------------------------------------

describe("CLI demo", () => {
  it("runs demo without server", () => {
    const { stdout, exitCode } = run(["demo", "--no-serve"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Building IPS Bundle");
    expect(stdout).toContain("Bundle built");
    expect(stdout).toContain("SHL created");
    expect(stdout).toContain("Passcode: 1234");
    expect(stdout).toContain("shlink:/");
  });
});
