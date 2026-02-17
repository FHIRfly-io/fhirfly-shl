# @fhirfly-io/shl

SMART Health Links SDK for Node.js — build FHIR Bundles from clinical codes, enrich with terminology, encrypt, and share via SHL/QR code.

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

## Quick Start

```typescript
import { IPS, SHL } from '@fhirfly-io/shl';
import { Fhirfly } from '@fhirfly-io/terminology';

const fhirfly = new Fhirfly({ apiKey: process.env.FHIRFLY_API_KEY });

// Build incrementally — each method is independently testable
const ips = new IPS.Bundle({
  patient: { name: 'Oliver Brown', dob: '1990-03-15', gender: 'male' },
});

ips.addMedication({ byNDC: '0069-3150-83', fhirfly });
ips.addCondition({ byICD10: 'E11.9', fhirfly });
ips.addImmunization({ byCVX: '207', fhirfly });
ips.addResult({ byLOINC: '2339-0', value: 95, unit: 'mg/dL' });
ips.addDocument({ pdf: pdfBuffer, title: 'Visit Summary' });

// Build with configurable output profile
const bundle = await ips.build({ profile: 'ips' });  // or 'r4' for generic FHIR

// Validate — mandatory before packaging
const validation = await bundle.validate();

// Package as SHL
const shl = await SHL.create(bundle, {
  storage: new SHL.S3Storage({ bucket: 'my-hipaa-bucket', region: 'us-east-1' }),
  expiration: '30d',
  passcode: { generate: true },
  label: 'Medical Summary for Oliver Brown',
});

console.log(shl.url);       // shlink:/eyJ1cmwiOiJodHRwczovL...
console.log(shl.qrCode);    // Base64 PNG
console.log(shl.passcode);  // Communicate out-of-band to patient
```

## Design Principles

- **Composable methods** — small, testable `add*` methods that build up a Bundle incrementally
- **Configurable output** — `build({ profile: "ips" })` for IPS document Bundles, `build({ profile: "r4" })` for generic FHIR collections
- **Bring Your Own Storage** — developer controls where encrypted PHI lives (S3, Azure, GCS, local)
- **Bring Your Own PDF** — SDK wraps pre-rendered PDFs as FHIR DocumentReference; you control rendering
- **Validation as a gate** — `SHL.create()` refuses to package invalid Bundles
- **Create-only for v1** — SHL creation; receiving/decoding is out of scope

## Output Profiles

| Profile | Bundle.type | Composition | Use Case |
|---------|-------------|-------------|----------|
| `"ips"` | `document` | Yes (with IPS sections) | Kill the Clipboard, patient portals |
| `"r4"` | `collection` | No | Apps needing FHIR Bundles without IPS compliance |

## Input Formats

Each `add*` method supports multiple input formats:

```typescript
// From raw codes (enriched via FHIRfly API)
ips.addMedication({ byNDC: '0069-3150-83', fhirfly });
ips.addMedication({ byRxNorm: '161', fhirfly });

// From SNOMED (no API call needed)
ips.addMedication({ bySNOMED: '376988009' });

// From existing FHIR R4 resources
ips.addMedication({ fromResource: existingMedicationStatement });
```

## Storage Adapters

```typescript
// AWS S3 (pre-signed URLs)
new SHL.S3Storage({ bucket: 'my-bucket', region: 'us-east-1' });

// Azure Blob Storage (SAS tokens)
new SHL.AzureStorage({ container: 'my-container', connectionString: '...' });

// Google Cloud Storage
new SHL.GCSStorage({ bucket: 'my-bucket' });

// Local filesystem (development/testing only)
new SHL.LocalStorage({ directory: './shl-data' });
```

## Related

- [@fhirfly-io/terminology](https://www.npmjs.com/package/@fhirfly-io/terminology) — FHIRfly terminology API SDK (required for code enrichment)
- [SMART Health Links Spec](https://docs.smarthealthit.org/smart-health-links/spec/)
- [IPS Implementation Guide](https://build.fhir.org/ig/HL7/fhir-ips/)
- [FHIRfly Documentation](https://fhirfly.io/docs)

## License

MIT
