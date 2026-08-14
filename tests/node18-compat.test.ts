// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import { describe, it, expect, afterEach } from "vitest";
import { IPS } from "../src/index.js";

// package.json declares engines.node >= 18, but globalThis.crypto only became a
// global in Node 19 (Node 18 requires --experimental-global-webcrypto). Deleting
// the global reproduces the Node 18 runtime here on any Node version, so the
// whole matrix guards it — not just the CI job that happens to run 18.

const PATIENT = { given: "Jane", family: "Doe", birthDate: "1990-01-15", gender: "female" as const };

const globals = globalThis as { crypto?: Crypto };
const realCrypto = globals.crypto;

describe("Node 18 compatibility", () => {
  afterEach(() => {
    globals.crypto = realCrypto;
  });

  it("builds a bundle without the WebCrypto global", async () => {
    delete globals.crypto;

    const bundle = new IPS.Bundle(PATIENT).addCondition({
      code: "E11.9",
      system: "http://hl7.org/fhir/sid/icd-10-cm",
      display: "Type 2 diabetes mellitus without complications",
    });

    const result = await bundle.build({ profile: "ips" });

    const entries = result.entry as Array<{ fullUrl: string }>;
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.fullUrl).toMatch(
        /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });
});
