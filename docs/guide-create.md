# Creating a SMART Health Link

This guide walks through building a FHIR IPS Bundle, validating it, and encrypting it into a SMART Health Link with a QR code.

**Prerequisites:** `npm install @fhirfly-io/shl`

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

### Input variants

Each `add*` method supports multiple input formats:

**Medication** — by RxNorm code, NDC code, SNOMED code, raw FHIR resource, or manual coding:
```typescript
bundle.addMedication({ code: "860975", system: "http://www.nlm.nih.gov/research/umls/rxnorm", display: "..." });
bundle.addMedication({ code: "0069-3060", system: "http://hl7.org/fhir/sid/ndc", display: "..." });
```

**Condition** — by ICD-10 code or SNOMED code:
```typescript
bundle.addCondition({ code: "E11.9", system: "http://hl7.org/fhir/sid/icd-10-cm", display: "Type 2 diabetes" });
bundle.addCondition({ code: "44054006", system: "http://snomed.info/sct", display: "Type 2 diabetes mellitus" });
```

**Immunization** — by CVX code:
```typescript
bundle.addImmunization({ code: "207", system: "http://hl7.org/fhir/sid/cvx", display: "COVID-19 vaccine" });
```

### Enrichment with FHIRfly API

If you have a FHIRfly API key, you can automatically resolve display names and add SNOMED cross-mappings:

```typescript
import { Fhirfly } from "@fhirfly-io/terminology";

const client = new Fhirfly({ apiKey: "ffly_live_..." });

const bundle = new IPS.Bundle({
  given: "Maria",
  family: "Garcia",
  birthDate: "1985-07-22",
  gender: "female",
  client, // pass the terminology client
});

// Now you can omit display names — the SDK looks them up automatically
bundle.addMedication({ code: "860975", system: "http://www.nlm.nih.gov/research/umls/rxnorm" });
```

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

### Severity levels

| Severity | Meaning | Example |
|----------|---------|---------|
| `error` | Blocks IPS compliance | Missing patient birthDate, no clinical resources |
| `warning` | Recommended but not required | Missing gender, no medication effectiveDate |
| `info` | Advisory best practice | Missing condition onsetDate |

For deeper validation (slicing rules, terminology bindings, full profile conformance), see the [Validation Guide](./validation.md) or paste your bundle JSON into [validator.fhir.org](https://validator.fhir.org/).

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

### Debug mode

When `debug: true` is set, `./shl-data/{id}/bundle.json` contains the unencrypted FHIR Bundle. Inspect it or paste it into [validator.fhir.org](https://validator.fhir.org/) to check compliance. Remove `debug: true` before deploying to production.

### Storage options

| Storage | Use case | Notes |
|---------|----------|-------|
| `SHL.LocalStorage` | Development, single-server | Writes to local filesystem |
| `SHL.S3Storage` | Production, multi-server | Requires `@aws-sdk/client-s3` |

Both accept `directory`/`bucket` and `baseUrl` (the public URL prefix for your SHL server).

---

## Next: Serve the SHL

Your encrypted SHL is stored locally. Next, [set up a server](./guide-serve.md) to serve it to anyone who scans the QR code.
