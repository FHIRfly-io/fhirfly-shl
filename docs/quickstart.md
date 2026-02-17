# SMART Health Links SDK — Quickstart Guide

![SHL Quickstart](https://assets.fhirfly.io/blog/heroes/shl-quickstart.png)

---

## What problem does this solve?

Sharing medical records today is broken. Patients carry paper printouts, fax machines still hum in every clinic, and "send me your records" usually means a phone tree, a release form, and a two-week wait.

SMART Health Links (SHL) fix this. A patient gets a **QR code** — one image that contains their encrypted health summary. They show it to a new doctor, a pharmacist, or an ER nurse. The recipient scans it, enters a passcode, and sees the patient's medications, conditions, allergies, and immunizations — instantly, on any device, with no app to install.

![How SHL works](https://assets.fhirfly.io/diagrams/shl-concept.svg)

The `@fhirfly-io/shl` SDK handles the hard parts: building a spec-compliant FHIR document, encrypting it, generating the QR code, and serving it to anyone who scans it.

---

## What you'll build

By the end of this guide, you'll have:

1. A **FHIR IPS Bundle** — a standardized patient summary document
2. A **validation check** — verify the bundle before sharing
3. An **encrypted SHL** — a QR code and `shlink:/` URL anyone can scan
4. A **server** that serves the encrypted content to viewers
5. A **round-trip verification** — decode the URL, decrypt the content, confirm the data survived

![SHL Pipeline](https://assets.fhirfly.io/diagrams/shl-pipeline.svg)

---

## Key concepts

Before we write code, here are the four ideas you need:

### IPS (International Patient Summary)

A standardized FHIR document containing the minimum useful patient data: demographics, medications, conditions, allergies, and immunizations. The IPS spec defines exactly which FHIR resources go where, which code systems to use, and what structure the document must have. The SDK's `IPS.Bundle` builder handles all of this — you provide simple inputs and it produces a spec-compliant document.

### SHL (SMART Health Link)

A protocol for sharing encrypted health data via a URL or QR code. The URL contains everything a viewer needs to retrieve and decrypt the data: a manifest endpoint, an encryption key, and flags indicating whether a passcode is required. The patient controls access — they choose the passcode, the expiration, and how many times the link can be used.

### Manifest mode

SHL supports two modes: embedded (data inside the URL) and manifest (data on a server). This SDK uses manifest mode exclusively, because IPS bundles are too large to embed in a QR code. In manifest mode, the viewer POSTs to a server to get a manifest listing available files, then GETs each file.

### JWE encryption

The health data is encrypted using JWE (JSON Web Encryption) with AES-256-GCM. The encryption key is embedded in the `shlink:/` URL itself — meaning only someone who has the URL (or scans the QR code) can decrypt the data. The server never sees the key; it stores and serves opaque encrypted blobs.

---

## Install

```bash
npm install @fhirfly-io/shl
```

That's it. One runtime dependency (`qrcode` for QR generation). No FHIR libraries, no crypto libraries, no framework lock-in.

**Optional extras:**

```bash
# If you want S3 storage instead of local filesystem
npm install @aws-sdk/client-s3

# If you want display names and SNOMED mappings from FHIRfly's API
npm install @fhirfly-io/terminology
```

---

## Step 1: Build a patient summary

```typescript
import { IPS } from "@fhirfly-io/shl";

// Create a bundle with patient demographics
const bundle = new IPS.Bundle({
  given: "Maria",
  family: "Garcia",
  birthDate: "1985-07-22",
  gender: "female",
});

// Add clinical data — each method accepts simple inputs
bundle.addMedication({
  code: "860975",
  system: "http://www.nlm.nih.gov/research/umls/rxnorm",
  display: "Metformin 500 MG Oral Tablet",
});

bundle.addCondition({
  code: "44054006",
  system: "http://snomed.info/sct",
  display: "Type 2 diabetes mellitus",
});

bundle.addAllergy({
  code: "91936005",
  system: "http://snomed.info/sct",
  display: "Allergy to penicillin",
});

bundle.addImmunization({
  code: "207",
  system: "http://hl7.org/fhir/sid/cvx",
  display: "COVID-19, mRNA, LNP-S, PF, 100 mcg/0.5mL dose",
});

// Build the FHIR document (async — resolves enrichment if configured)
const fhirBundle = await bundle.build();
```

The result is a full FHIR R4 Bundle with a Composition resource linking to Patient, MedicationStatement, Condition, AllergyIntolerance, and Immunization resources — all structured per the IPS Implementation Guide.

**Checkpoint:** `fhirBundle.resourceType` is `"Bundle"` and `fhirBundle.type` is `"document"`.

---

## Step 2: Validate the bundle

Before encrypting, check for structural issues and IPS compliance warnings:

```typescript
const result = bundle.validate();

if (!result.valid) {
  console.error("Validation errors:", result.issues);
  // Fix errors before proceeding — the bundle may not be IPS-compliant
}

// Check informational warnings too
for (const issue of result.issues) {
  if (issue.severity === "warning") {
    console.warn(`${issue.path}: ${issue.message}`);
  }
}
```

The SDK validates patient demographics, required IPS fields, and flags missing recommended data (like gender, medication dates, and condition onset dates). Errors prevent IPS compliance; warnings and informational issues are advisory.

For deeper validation (slicing rules, terminology bindings, full profile conformance), use the [HL7 FHIR Validator](https://github.com/hapifhir/org.hl7.fhir.core) or paste your bundle JSON into [validator.fhir.org](https://validator.fhir.org/).

**Checkpoint:** `result.valid` is `true` with no error-level issues.

---

## Step 3: Encrypt and create the SHL

```typescript
import { SHL } from "@fhirfly-io/shl";

const storage = new SHL.LocalStorage({
  directory: "./shl-data",
  baseUrl: "http://localhost:3000/shl",
});

const result = await SHL.create({
  bundle: fhirBundle,
  storage,
  passcode: "1234",
  label: "Maria Garcia — Patient Summary",
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
  maxAccesses: 10,
  debug: true, // saves unencrypted bundle for inspection (development only!)
});

console.log(result.url);       // shlink:/eyJ1cmwiOi...
console.log(result.qrCode);    // data:image/png;base64,...
console.log(result.id);        // base64url ID (43 chars)
console.log(result.passcode);  // "1234"
```

This does four things:
1. Generates a random 256-bit encryption key and SHL ID
2. Encrypts the FHIR bundle as a JWE (AES-256-GCM, DEFLATE compression)
3. Stores three files: `content.jwe`, `manifest.json`, `metadata.json`
4. Builds the `shlink:/` URL (with the key embedded) and a QR code PNG

**Checkpoint:** `./shl-data/{id}/` contains three files (plus `bundle.json` if debug is enabled). The `shlink:/` URL starts with `shlink:/eyJ`.

If debug mode is enabled, `./shl-data/{id}/bundle.json` contains the unencrypted FHIR Bundle — inspect it or paste it into [validator.fhir.org](https://validator.fhir.org/) to check compliance. Remove `debug: true` before deploying to production.

---

## Step 4: Serve the SHL

The QR code points viewers to your server. The SDK provides framework adapters so you don't have to implement the SHL protocol yourself.

**Express:**

```typescript
import express from "express";
import { expressMiddleware } from "@fhirfly-io/shl/express";
import { ServerLocalStorage } from "@fhirfly-io/shl/server";

const storage = new ServerLocalStorage({
  directory: "./shl-data",
  baseUrl: "http://localhost:3000/shl",
});

const app = express();
app.use(express.json());
app.use("/shl", expressMiddleware({ storage }));
app.listen(3000);
```

**Fastify:**

```typescript
import Fastify from "fastify";
import { fastifyPlugin } from "@fhirfly-io/shl/fastify";
import { ServerLocalStorage } from "@fhirfly-io/shl/server";

const storage = new ServerLocalStorage({
  directory: "./shl-data",
  baseUrl: "http://localhost:3000/shl",
});

const app = Fastify();
app.register(fastifyPlugin({ storage }), { prefix: "/shl" });
app.listen({ port: 3000 });
```

**AWS Lambda:**

```typescript
import { lambdaHandler } from "@fhirfly-io/shl/lambda";
import { ServerS3Storage } from "@fhirfly-io/shl/server";

export const handler = lambdaHandler({
  storage: new ServerS3Storage({
    bucket: "my-shl-bucket",
    region: "us-east-1",
    baseUrl: "https://shl.example.com",
  }),
  pathPrefix: "/shl",
});
```

The server handles two routes:

| Route | Method | What it does |
|-------|--------|--------------|
| `/{shlId}` | POST | Validates passcode, checks expiration/access limits, returns manifest |
| `/{shlId}/content` | GET | Returns the encrypted JWE with `Content-Type: application/jose` |

**Checkpoint:** `curl -X POST http://localhost:3000/shl/{id} -H "Content-Type: application/json" -d '{"passcode":"1234"}'` returns a JSON manifest with a `files` array.

---

## Step 5: Verify the round-trip

Decode the `shlink:/` URL and decrypt the content to confirm everything works:

```typescript
import { SHL } from "@fhirfly-io/shl";

// 1. Decode the URL
const decoded = SHL.decode(result.url);
console.log(decoded.url);   // manifest endpoint
console.log(decoded.flag);  // "LP" (manifest mode + passcode)
console.log(decoded.label); // "Maria Garcia — Patient Summary"

// 2. Fetch the manifest (simulating what a viewer app does)
const manifest = await fetch(decoded.url, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ passcode: "1234" }),
}).then(r => r.json());

// 3. Fetch the encrypted content
const jwe = await fetch(manifest.files[0].location).then(r => r.text());

// 4. Decrypt with the key from the URL
const decrypted = SHL.decrypt(jwe, decoded.key);
console.log(decrypted.resourceType); // "Bundle"
console.log(decrypted.type);         // "document"
```

**Checkpoint:** `decrypted` is identical to the original `fhirBundle` you built in Step 1.

---

## Package structure

The SDK uses subpath exports to keep server code separate from client code. If you're only building bundles, you never load Express/Fastify/Lambda types:

```
import { IPS, SHL } from "@fhirfly-io/shl"              // IPS builder + SHL create/decode/decrypt
import { createHandler } from "@fhirfly-io/shl/server"   // Framework-agnostic handler
import { expressMiddleware } from "@fhirfly-io/shl/express"  // Express adapter
import { fastifyPlugin } from "@fhirfly-io/shl/fastify"     // Fastify adapter
import { lambdaHandler } from "@fhirfly-io/shl/lambda"      // Lambda adapter
```

---

## What's encrypted, what's not

| Data | Encrypted? | Who can see it? |
|------|-----------|-----------------|
| FHIR Bundle (patient data) | Yes (AES-256-GCM) | Only someone with the `shlink:/` URL |
| Encryption key | Embedded in URL | Only someone with the URL or QR code |
| Passcode | Stored in metadata on your server | Your server (for validation) |
| SHL ID | In the URL and on your server | Anyone with the URL; your server |
| Access count, expiration | Stored in metadata on your server | Your server |

The server never sees the decryption key. It stores and serves opaque encrypted blobs. The key travels only in the `shlink:/` URL, which the patient controls.

---

## Next steps

This guide covers the basics. From here, you might want to:

- **Enrich with FHIRfly's API** — Use `@fhirfly-io/terminology` to automatically add display names and SNOMED mappings to your clinical codes
- **Validate your bundle** — Use the HL7 FHIR Validator or `validator.fhir.org` to confirm IPS compliance
- **Use S3 storage** — Replace `LocalStorage` with `S3Storage` for production deployments
- **Monitor access** — Use the `onAccess` callback to log who's viewing the SHL

---

## Reference

- [SMART Health Links Specification](https://docs.smarthealthit.org/smart-health-links/spec/)
- [IPS Implementation Guide](https://build.fhir.org/ig/HL7/fhir-ips/)
- [HL7 FHIR Validator](https://github.com/hapifhir/org.hl7.fhir.core)
- [CommonHealth SHL Viewer](https://viewer.commonhealth.org/) — scan QR codes to test your SHLs
