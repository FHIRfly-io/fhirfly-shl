# PSHD Implementation Guide

Patient-Shared Health Document (PSHD) support for the `@fhirfly-io/shl` SDK.

## What is PSHD?

The [Patient-Shared Health Document (PSHD) spec](https://hackmd.io/@Jyncr3iQS1iJA09xcuh7QA/rkGeS5cIZe) (v0.4.0) is a CMS-aligned profile of [SMART Health Links (SHL STU1)](https://build.fhir.org/ig/AudaciousInquiry/smart-health-links/index.html) designed for patient-to-provider data sharing at the point of care. A patient presents a QR code at a clinic visit, and the provider scans it to retrieve the patient's summary.

Key differences from standard SHLinks:

| Feature | Standard SHL | PSHD |
|---|---|---|
| Retrieval mode | Manifest (`POST`, flag `L`) | Direct (`GET`, flag `U`) |
| Bundle type | `document` (with Composition) | `collection` (no Composition) |
| Passcode | Optional (flag `P`) | Forbidden (incompatible with flag `U`) |
| Expiration | Optional | Required (short-lived) |
| DocumentReference type | LOINC 34133-9 | LOINC **60591-5** |
| DocumentReference category | None | CMS `patient-shared` |
| Security label | None | `PATAST` (patient-asserted) |
| DocumentReference author | SDK / Organization | Patient reference |

The SDK supports PSHD through two layers:

- **High-level**: `compliance: "pshd"` on `SHL.create()` enforces all constraints automatically
- **Low-level**: `mode: "direct"` and `profile: "pshd"` can be used independently

## Quick Start

End-to-end example: build a PSHD-compliant bundle, create a SMART Health Link, and serve it.

```typescript
import { IPS, SHL } from "@fhirfly-io/shl";
import { CODE_SYSTEMS } from "@fhirfly-io/shl";
import { readFileSync } from "node:fs";

// 1. Build the FHIR Bundle with PSHD profile
const bundle = new IPS.Bundle({
  given: "Jane",
  family: "Doe",
  birthDate: "1990-01-15",
  gender: "female",
});

bundle.addMedication({
  code: "860975",
  system: CODE_SYSTEMS.RXNORM,
  display: "Metformin 500 MG Oral Tablet",
  status: "active",
});

bundle.addCondition({
  code: "44054006",
  system: CODE_SYSTEMS.SNOMED,
  display: "Type 2 diabetes mellitus",
  clinicalStatus: "active",
});

// PSHD requires at least one PDF document
const pdfContent = readFileSync("./patient-summary.pdf");
bundle.addDocument({ title: "Patient Summary", content: pdfContent });

// Validate before building
const validation = bundle.validate({ profile: "pshd" });
if (!validation.valid) {
  console.error("Validation errors:", validation.issues);
  process.exit(1);
}

const fhirBundle = await bundle.build({ profile: "pshd" });

// 2. Create the SMART Health Link with PSHD compliance
const result = await SHL.create({
  bundle: fhirBundle,
  storage: new SHL.LocalStorage({
    directory: "./shl-data",
    baseUrl: "https://shl.example.com",
  }),
  compliance: "pshd",
  expiresAt: "point-of-care", // 15 minutes (named preset)
  label: "Jane Doe - Patient Summary",
});

console.log(result.url);     // shlink:/eyJ1cmwiOiJodHRwcz...
console.log(result.qrCode);  // data:image/png;base64,...
console.log(result.id);      // unique SHL identifier
```

The `compliance: "pshd"` preset automatically:
- Sets direct retrieval mode (flag `U`)
- Rejects passcode (incompatible with direct mode)
- Requires `expiresAt` (short-lived links for point-of-care)

## PSHD Bundle Profile

Use `profile: "pshd"` on `bundle.build()` to produce a PSHD-compliant FHIR Bundle.

### Bundle Structure

A PSHD bundle differs from a standard IPS bundle:

```
PSHD Bundle (type: "collection")        IPS Bundle (type: "document")
├── Patient                              ├── Composition ← not in PSHD
├── MedicationStatement(s)               ├── Patient
├── Condition(s)                         ├── MedicationStatement(s)
├── AllergyIntolerance(s)                ├── Condition(s)
├── Immunization(s)                      ├── AllergyIntolerance(s)
├── Observation(s)                       ├── Immunization(s)
├── DocumentReference (1..1)             ├── Observation(s)
└── Binary                               └── DocumentReference + Binary
```

- **Bundle type** is `collection`, not `document`
- **No Composition resource** -- PSHD does not require one
- **Patient is the first entry**
- **DocumentReference is required** (1..1) and must contain a PDF
- **`timestamp`** is always set
- **No `meta.profile`** on resources (PSHD strips IPS profile URIs)

### DocumentReference Constraints

When `profile === "pshd"`, the SDK automatically applies these overrides to every DocumentReference:

| Field | IPS / R4 Default | PSHD Value |
|---|---|---|
| `type.coding[0].code` | `34133-9` | `60591-5` |
| `type.coding[0].display` | "Summarization of episode note" | "Patient summary Document" |
| `category` | (none) | `patient-shared` (CMS code system) |
| `author` | (none) | Patient reference |
| `meta.security` | (none) | `PATAST` (patient-asserted) |
| `meta.profile` | IPS URI | (none -- stripped) |

Example DocumentReference output:

```json
{
  "resourceType": "DocumentReference",
  "status": "current",
  "type": {
    "coding": [{
      "system": "http://loinc.org",
      "code": "60591-5",
      "display": "Patient summary Document"
    }]
  },
  "category": [{
    "coding": [{
      "system": "https://cms.gov/fhir/CodeSystem/patient-shared-category",
      "code": "patient-shared",
      "display": "Patient Shared"
    }]
  }],
  "author": [{ "reference": "urn:uuid:<patient-id>" }],
  "meta": {
    "security": [{
      "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
      "code": "PATAST",
      "display": "patient asserted"
    }]
  },
  "subject": { "reference": "urn:uuid:<patient-id>" },
  "content": [{
    "attachment": {
      "contentType": "application/pdf",
      "url": "urn:uuid:<binary-id>",
      "title": "Patient Summary"
    }
  }]
}
```

### PSHD Validation Rules

`bundle.validate({ profile: "pshd" })` checks:

| Rule | Severity | Message |
|---|---|---|
| No documents added | Error | "PSHD requires at least one DocumentReference (1..1)" |
| No PDF document | Error | "PSHD requires at least one PDF document" |
| Missing `Patient.gender` | Warning | "Patient.gender recommended for PSHD demographic matching" |
| Invalid `birthDate` format | Error | "birthDate must be in YYYY-MM-DD format" |

## SHL Direct Mode

PSHD uses **direct retrieval** (flag `U`) instead of the standard manifest flow (flag `L`).

### How Direct Mode Works

| Step | Manifest Mode (flag L) | Direct Mode (flag U) |
|---|---|---|
| 1. Scan QR | `shlink:/...` with `flag: "L"` | `shlink:/...` with `flag: "U"` |
| 2. Retrieve | `POST /{shlId}` → manifest JSON | `GET /{shlId}` → encrypted content |
| 3. Content | `GET /{shlId}/content` → JWE | (included in step 2) |
| Round trips | 2 | 1 |

Direct mode is faster because the receiver gets the encrypted content in a single GET request instead of a POST-then-GET flow.

### Using `compliance: "pshd"`

The high-level preset enforces all PSHD constraints:

```typescript
const result = await SHL.create({
  bundle: fhirBundle,
  storage,
  compliance: "pshd",                        // forces direct mode, requires exp
  expiresAt: new Date(Date.now() + 15 * 60_000),
});
// result.url contains flag "U"
```

The SDK throws `ValidationError` if:
- `passcode` is provided (flag `U` is incompatible with flag `P`)
- `expiresAt` is missing (PSHD requires short-lived links)

### Using `mode: "direct"` Independently

You can use direct mode without the full PSHD compliance preset:

```typescript
const result = await SHL.create({
  bundle: anyFhirBundle,  // does not need to be a PSHD bundle
  storage,
  mode: "direct",
  expiresAt: new Date(Date.now() + 60 * 60_000), // optional here
});
```

This sets flag `U` but does not enforce expiration or bundle profile. Still rejects passcode (fundamental SHL protocol constraint -- flag `U` and flag `P` are mutually exclusive).

### Storage Layout

Direct-mode SHLs store fewer files because no manifest is needed:

```
Direct mode (flag U)         Manifest mode (flag L, default)
{shlId}/                     {shlId}/
├── content.jwe              ├── content.jwe
└── metadata.json            ├── manifest.json
                             └── metadata.json
```

The `metadata.json` for direct-mode SHLs includes `"mode": "direct"`, which the server handler uses to route GET requests correctly.

## Expiration Guidance

PSHD links are designed for point-of-care use. Choose expiration based on the sharing scenario:

| Scenario | Recommended TTL | Example |
|---|---|---|
| Walk-in / urgent care | 10-15 minutes | Patient shows QR at front desk |
| Scheduled appointment | 1-4 hours | Patient shares before the visit |
| Pre-visit preparation | 24 hours | Shared day before appointment |
| Emergency transfer | 30-60 minutes | Patient transferred between facilities |

Use named presets or raw `Date` objects:

```typescript
// Named presets (v0.5.0+)
expiresAt: "point-of-care"  // 15 minutes
expiresAt: "appointment"    // 24 hours

// Raw Date (still works)
expiresAt: new Date(Date.now() + 4 * 60 * 60_000) // 4 hours
```

| Preset | Duration | Typical Use |
|--------|----------|-------------|
| `"point-of-care"` | 15 minutes | Walk-in, urgent care |
| `"appointment"` | 24 hours | Scheduled visit, pre-visit prep |
| `"travel"` | 90 days | International travel |
| `"permanent"` | No expiration | Not recommended for PSHD |

You can combine expiration with `maxAccesses` for defense in depth:

```typescript
await SHL.create({
  bundle: fhirBundle,
  storage,
  compliance: "pshd",
  expiresAt: new Date(Date.now() + 15 * 60_000),
  maxAccesses: 3, // fail-safe: max 3 scans even within the time window
});
```

## Server Setup

The server handler automatically routes direct-mode SHLs. All three framework adapters support the new `GET /{shlId}` route for flag-U retrieval.

### Express

```typescript
import express from "express";
import { expressMiddleware } from "@fhirfly-io/shl/express";
import { ServerLocalStorage } from "@fhirfly-io/shl/server";

const app = express();
app.use(express.json());

app.use("/shl", expressMiddleware({
  storage: new ServerLocalStorage({
    directory: "./shl-data",
    baseUrl: "https://shl.example.com/shl",
  }),
  onAccess: (event) => {
    console.log(`[SHL] ${event.mode} access to ${event.shlId}`, {
      recipient: event.recipient,
      count: event.accessCount,
    });
  },
}));

app.listen(3000);
```

### Fastify

```typescript
import Fastify from "fastify";
import { fastifyPlugin } from "@fhirfly-io/shl/fastify";
import { ServerLocalStorage } from "@fhirfly-io/shl/server";

const app = Fastify();

app.register(fastifyPlugin({
  storage: new ServerLocalStorage({
    directory: "./shl-data",
    baseUrl: "https://shl.example.com/shl",
  }),
  onAccess: (event) => {
    console.log(`[SHL] ${event.mode} access to ${event.shlId}`);
  },
}), { prefix: "/shl" });

await app.listen({ port: 3000 });
```

The Fastify plugin registers these routes:
- `POST /:shlId` -- manifest access (flag L)
- `GET /:shlId` -- direct access (flag U)
- `GET /:shlId/content` -- encrypted content (manifest flow step 2)
- `GET /:shlId/attachment/:index` -- encrypted attachments

### AWS Lambda

```typescript
import { lambdaHandler } from "@fhirfly-io/shl/lambda";
import { ServerS3Storage } from "@fhirfly-io/shl/server";

export const handler = lambdaHandler({
  storage: new ServerS3Storage({
    bucket: "my-shl-bucket",
    region: "us-east-1",
    baseUrl: "https://shl.example.com/shl",
  }),
  pathPrefix: "/shl",
  onAccess: async (event) => {
    // Log to CloudWatch with structured fields
    console.log(JSON.stringify({
      type: "shl_access",
      shlId: event.shlId,
      mode: event.mode,
      recipient: event.recipient,
      accessCount: event.accessCount,
      timestamp: event.timestamp.toISOString(),
    }));
  },
});
```

### Backward Compatibility

The new `GET /{shlId}` route only serves direct-mode SHLs. If a GET request hits a manifest-mode SHL (no `mode: "direct"` in metadata), the handler returns **405 Method Not Allowed** with a message to use POST. Existing manifest-mode SHLs continue to work exactly as before.

## Audit Logging

There are two ways to capture access events:

### 1. `onAccess` callback (handler-level)

The `onAccess` callback fires on every successful access (both manifest and direct modes):

```typescript
onAccess: (event) => {
  if (event.recipient) {
    auditLog.write({
      action: "patient_data_accessed",
      shlId: event.shlId,
      recipient: event.recipient,
      mode: event.mode,
      timestamp: event.timestamp,
    });
  }
}
```

### 2. `AuditableStorage` interface (storage-level)

For storage-level audit logging, implement `AuditableStorage`. This is opt-in — existing `SHLServerStorage` implementations work unchanged.

```typescript
import { AuditableStorage, AccessEvent, isAuditableStorage } from "@fhirfly-io/shl/server";

class AuditedStorage extends ServerLocalStorage implements AuditableStorage {
  async onAccess(shlId: string, event: AccessEvent): Promise<void> {
    await db.auditLog.insert({
      shlId,
      recipient: event.recipient,
      ip: event.ip,
      userAgent: event.userAgent,
      timestamp: event.timestamp,
    });
  }
}

// The server handler auto-detects AuditableStorage via isAuditableStorage()
app.use("/shl", expressMiddleware({ storage: new AuditedStorage({ ... }) }));
```

Both mechanisms can be used together — the handler-level `onAccess` fires first, then the storage-level `onAccess`.

### AccessEvent Fields

| Field | Type | Description |
|-------|------|-------------|
| `timestamp` | `number` | Epoch milliseconds |
| `recipient` | `string?` | From `?recipient=` query parameter |
| `ip` | `string?` | Client IP address |
| `userAgent` | `string?` | Client User-Agent header |

### Recipient Tracking

SHL viewers pass `?recipient=` to identify the provider scanning the QR code:

```
GET /shl/{shlId}?recipient=Dr.%20Smith
```

This supports the PSHD spec's requirement for audit trails of who accessed patient-shared data and when.

## Migration Guide

All changes are backward-compatible. Existing code continues to work without modification.

### New Options

| Option | Where | Values | Default |
|---|---|---|---|
| `compliance` | `SHL.create()` | `"pshd"` | (none) |
| `mode` | `SHL.create()` | `"manifest"` \| `"direct"` | `"manifest"` |
| `profile` | `bundle.build()` | `"ips"` \| `"r4"` \| `"pshd"` | `"ips"` |

### New Types

| Type | Export | Description |
|---|---|---|
| `BundleProfile` | `IPS.BundleProfile` | `"ips" \| "r4" \| "pshd"` |
| `ExpirationPreset` | `SHL.ExpirationPreset` | `"point-of-care" \| "appointment" \| "travel" \| "permanent"` |
| `AuditableStorage` | `import from "@fhirfly-io/shl/server"` | Storage with `onAccess()` hook |
| `AccessEvent` | `import from "@fhirfly-io/shl/server"` | Audit event payload |
| `isAuditableStorage()` | `import from "@fhirfly-io/shl/server"` | Runtime type guard for `AuditableStorage` |

### New AccessEvent Fields

| Field | Type | Description |
|---|---|---|
| `recipient` | `string?` | From `?recipient=` query param |
| `mode` | `"manifest" \| "direct"?` | Retrieval mode used |

### What Stays the Same

- Default `SHL.create()` still uses manifest mode (flag `L`)
- Default `bundle.build()` still uses IPS profile
- All existing tests pass without changes
- Server handler routes for manifest mode are unchanged
- Storage format for manifest-mode SHLs is unchanged

### Upgrading

1. Update `@fhirfly-io/shl` to the latest version
2. No code changes required for existing functionality
3. To use PSHD, add `profile: "pshd"` to `build()` and `compliance: "pshd"` to `SHL.create()`
4. Update your `onAccess` callback to handle the new `mode` and `recipient` fields (both optional, so existing callbacks still work)
