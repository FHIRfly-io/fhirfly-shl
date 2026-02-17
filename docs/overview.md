# SMART Health Links SDK

![SHL Quickstart](https://assets.fhirfly.io/blog/heroes/shl-quickstart.png)

---

## What problem does this solve?

Sharing medical records today is broken. Patients carry paper printouts, fax machines still hum in every clinic, and "send me your records" usually means a phone tree, a release form, and a two-week wait.

SMART Health Links (SHL) fix this. A patient gets a **QR code** — one image that contains their encrypted health summary. They show it to a new doctor, a pharmacist, or an ER nurse. The recipient scans it, enters a passcode, and sees the patient's medications, conditions, allergies, and immunizations — instantly, on any device, with no app to install.

![How SHL works](https://assets.fhirfly.io/diagrams/shl-concept.svg)

The `@fhirfly-io/shl` SDK handles the hard parts: building a spec-compliant FHIR document, encrypting it, generating the QR code, and serving it to anyone who scans it.

---

## Key concepts

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

## Guides

Build a complete SHL workflow in three steps:

1. **[Creating a SMART Health Link](./guide-create.md)** — Build a FHIR IPS Bundle, validate it, encrypt it, and generate a QR code
2. **[Serving SMART Health Links](./guide-serve.md)** — Set up Express, Fastify, or Lambda to serve encrypted content
3. **[Consuming SMART Health Links](./guide-consume.md)** — Decode the URL, fetch the manifest, decrypt the content

---

## Reference

- [SMART Health Links Specification](https://docs.smarthealthit.org/smart-health-links/spec/)
- [IPS Implementation Guide](https://build.fhir.org/ig/HL7/fhir-ips/)
- [HL7 FHIR Validator](https://github.com/hapifhir/org.hl7.fhir.core)
- [CommonHealth SHL Viewer](https://viewer.commonhealth.org/) — scan QR codes to test your SHLs
