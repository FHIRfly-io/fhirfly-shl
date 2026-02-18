# @fhirfly-io/shl

SMART Health Links SDK for Node.js — build IPS FHIR Bundles from clinical codes, encrypt, and share via SHL/QR code.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

## What It Does

Takes raw clinical data (NDC codes, ICD-10 codes, RxNorm, LOINC, CVX) and produces a shareable SMART Health Link:

```
Raw codes + patient info → Enriched FHIR Bundle → Encrypted SHL → QR code
```

PHI never leaves your server. Only terminology codes are sent to FHIRfly for enrichment — no BAA required.

## Installation

```bash
npm install @fhirfly-io/shl
```

For FHIRfly API enrichment (recommended):

```bash
npm install @fhirfly-io/shl @fhirfly-io/terminology
```

## Quick Start

```typescript
import { IPS, SHL } from "@fhirfly-io/shl";
import Fhirfly from "@fhirfly-io/terminology";

const client = new Fhirfly({ apiKey: process.env.FHIRFLY_API_KEY });

// Build the IPS Bundle
const bundle = new IPS.Bundle({
  patient: { name: "Maria Garcia", birthDate: "1985-03-15", gender: "female" },
});

bundle.addMedication({ byNDC: "00071015523", fhirfly: client.ndc });
bundle.addCondition({ byICD10: "E11.9", fhirfly: client.icd10 });
bundle.addAllergy({ bySNOMED: "387207008" });
bundle.addImmunization({ byCVX: "208", fhirfly: client.cvx });
bundle.addResult({ byLOINC: "2339-0", fhirfly: client.loinc, value: 95, unit: "mg/dL" });
bundle.addDocument({ content: pdfBuffer, contentType: "application/pdf", title: "Visit Summary" });

const fhirBundle = await bundle.build();

// Create the SHL (zero-infra with FhirflyStorage)
const storage = new SHL.FhirflyStorage({ apiKey: process.env.FHIRFLY_API_KEY });

const result = await SHL.create({
  bundle: fhirBundle,
  storage,
  passcode: "1234",
  label: "Maria's Health Summary",
});

console.log(result.url);      // shlink:/eyJ1cmwiOiJodHRwczovL...
console.log(result.qrCode);   // data:image/png;base64,...
console.log(result.passcode); // "1234"
```

## Storage Adapters

```typescript
// FHIRfly hosted (zero infrastructure, recommended)
new SHL.FhirflyStorage({ apiKey: "..." });

// AWS S3
new SHL.S3Storage({ bucket: "my-bucket", region: "us-east-1", baseUrl: "https://shl.example.com" });

// Azure Blob Storage
new SHL.AzureStorage({ container: "shl-data", connectionString: "...", baseUrl: "https://shl.example.com" });

// Google Cloud Storage
new SHL.GCSStorage({ bucket: "my-bucket", baseUrl: "https://shl.example.com" });

// Local filesystem (development)
new SHL.LocalStorage({ directory: "./shl-data", baseUrl: "http://localhost:3456/shl" });
```

## Input Formats

Each `add*` method supports multiple input formats:

```typescript
// From codes (enriched via FHIRfly API)
bundle.addMedication({ byNDC: "00071015523", fhirfly: client.ndc });
bundle.addMedication({ byRxNorm: "161", fhirfly: client.rxnorm });
bundle.addCondition({ byICD10: "E11.9", fhirfly: client.icd10 });
bundle.addResult({ byLOINC: "2339-0", fhirfly: client.loinc, value: 95, unit: "mg/dL" });
bundle.addImmunization({ byCVX: "208", fhirfly: client.cvx });

// From SNOMED (no API call needed)
bundle.addMedication({ bySNOMED: "376988009" });
bundle.addAllergy({ bySNOMED: "387207008" });

// From existing FHIR R4 resources
bundle.addMedication({ fromResource: existingMedicationStatement });
bundle.addCondition({ fromResource: existingCondition });

// Manual coding (no API dependency)
bundle.addMedication({ code: "376988009", system: "http://snomed.info/sct", display: "Levothyroxine" });
```

## CLI

```bash
npx @fhirfly-io/shl validate bundle.json   # Validate a FHIR Bundle
npx @fhirfly-io/shl create bundle.json     # Create an SHL from a bundle
npx @fhirfly-io/shl decode shlink:/eyJ...  # Decode an SHL URL
npx @fhirfly-io/shl serve                  # Start a local SHL server
npx @fhirfly-io/shl demo                   # Full round-trip demo
```

## Server Middleware

Host your own SHL endpoints:

```typescript
import express from "express";
import { createShlMiddleware } from "@fhirfly-io/shl/express";
import { ServerLocalStorage } from "@fhirfly-io/shl/server";

const storage = new ServerLocalStorage({
  directory: "./shl-data",
  baseUrl: "http://localhost:3000/shl",
});

const app = express();
app.use("/shl", createShlMiddleware({ storage }));
app.listen(3000);
```

Also available for Fastify (`@fhirfly-io/shl/fastify`) and Lambda (`@fhirfly-io/shl/lambda`).

## Live Exercise

Run the comprehensive integration test against the live API to exercise every SDK path:

```bash
npx tsx examples/live-exercise/index.ts --api-key <your-key> --verbose
```

Covers bundle building, FhirflyStorage, LocalStorage + Express, SHL consumption, access control, and edge cases. See [`examples/live-exercise/README.md`](examples/live-exercise/README.md) for details.

## Related

- [@fhirfly-io/terminology](https://www.npmjs.com/package/@fhirfly-io/terminology) — FHIRfly terminology API SDK
- [SMART Health Links Spec](https://docs.smarthealthit.org/smart-health-links/spec/)
- [IPS Implementation Guide](https://build.fhir.org/ig/HL7/fhir-ips/)
- [FHIRfly SHL Docs](https://fhirfly.io/docs/shl/overview)
- [SHL Viewer](https://fhirfly.io/shl/viewer)

## License

MIT
