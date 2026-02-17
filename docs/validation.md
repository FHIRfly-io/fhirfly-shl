# FHIR Validation Guide

Validating your IPS bundle ensures it meets the FHIR standard and the IPS profile requirements before you share it. This guide covers three levels of validation: SDK built-in checks, the HL7 FHIR Validator, and online tools.

---

## SDK validation: `bundle.validate()`

The SDK's built-in validator runs synchronously and catches the most common issues:

```typescript
const result = bundle.validate();

if (!result.valid) {
  console.error("Errors:", result.issues.filter(i => i.severity === "error"));
}

for (const issue of result.issues) {
  console.log(`[${issue.severity}] ${issue.path}: ${issue.message}`);
}
```

### What it checks

| Check | Severity | Path | Message |
|-------|----------|------|---------|
| Birth date format | `error` | `Patient.birthDate` | birthDate must be in YYYY-MM-DD format |
| Patient name required | `error` | `Patient.name` | Patient.name must have at least a given, family, or text (ips-pat-1) |
| Gender recommended | `warning` | `Patient.gender` | Patient.gender is recommended by the IPS profile |
| Medication effective date (fromResource) | `warning` | `MedicationStatement.effective[x]` | fromResource MedicationStatement missing effective[x] |
| Medication effective date (manual) | `info` | `MedicationStatement.effectiveDateTime` | Medication has no effectiveDate — the SDK will default to today's date |
| Condition onset date | `info` | `Condition.onsetDateTime` | Condition has no onsetDate — recommended by IPS but not required |
| Immunization occurrence date | `info` | `Immunization.occurrenceDateTime` | Immunization has no occurrenceDate — recommended by IPS but not required |

### Interpreting `ValidationResult`

```typescript
interface ValidationResult {
  valid: boolean;           // true if zero error-severity issues
  issues: ValidationIssue[];
}

interface ValidationIssue {
  severity: "error" | "warning" | "information";
  message: string;
  path?: string;            // FHIRPath expression
}
```

- **`valid: true`** means no errors. Warnings and informational issues are advisory.
- **`error`** issues block IPS compliance — fix them before sharing.
- **`warning`** issues are strongly recommended by the IPS profile but won't break viewers.
- **`information`** issues are best-practice suggestions.

### Limitations

The SDK validator is intentionally lightweight. It does **not** check:

- FHIR slicing rules (e.g., Composition section cardinality)
- Terminology bindings (e.g., whether a SNOMED code is in the IPS value set)
- Full profile conformance (e.g., must-support flags)
- Cross-resource reference integrity

For these deeper checks, use the HL7 FHIR Validator.

---

## HL7 FHIR Validator (deep validation)

The [HL7 FHIR Validator](https://github.com/hapifhir/org.hl7.fhir.core) is the reference implementation for FHIR validation. It checks slicing, terminology bindings, profile conformance, and reference integrity.

### Setup

Download the validator CLI:

```bash
curl -L -o validator_cli.jar \
  https://github.com/hapifhir/org.hl7.fhir.core/releases/latest/download/validator_cli.jar
```

Requires Java 11+.

### Run as IPS

To validate against the IPS profile:

```bash
java -jar validator_cli.jar bundle.json \
  -ig hl7.fhir.uv.ips \
  -profile http://hl7.org/fhir/uv/ips/StructureDefinition/Bundle-uv-ips
```

The `-ig hl7.fhir.uv.ips` flag downloads the IPS Implementation Guide (cached after first run). The `-profile` flag validates against the IPS Bundle profile specifically.

### Getting the bundle JSON

Use debug mode when creating your SHL to save the unencrypted bundle:

```typescript
const result = await SHL.create({
  bundle: fhirBundle,
  storage,
  debug: true,  // saves bundle.json alongside encrypted files
});
// ./shl-data/{id}/bundle.json is now available for validation
```

Or export it manually:

```typescript
const fhirBundle = await bundle.build();
const fs = await import("fs");
fs.writeFileSync("bundle.json", JSON.stringify(fhirBundle, null, 2));
```

### Interpreting results

The validator outputs issues with severity levels:

| Level | Meaning | Action |
|-------|---------|--------|
| **Fatal** | Unparseable input | Fix the JSON structure |
| **Error** | Violates FHIR or IPS rules | Must fix for compliance |
| **Warning** | Best practice violation | Should fix; viewers may still work |
| **Information** | Advisory note | Optional; cosmetic improvements |

### Common warnings you can safely ignore

| Warning | Why it's OK |
|---------|-------------|
| `Composition.section: minimum required = 3...` | IPS requires medication, allergy, and problem sections. If your bundle has all three, this is a false positive from section ordering. |
| `Unable to resolve resource...` | The validator can't follow `fullUrl` references. If your bundle works end-to-end, this is fine. |

### Common errors that need fixing

| Error | Fix |
|-------|-----|
| `Patient.birthDate: not a valid date` | Use `YYYY-MM-DD` format |
| `Coding has no system` | Always provide `system` and `code` together |
| `Bundle.type: must be 'document'` | Use `bundle.build()` — don't construct the Bundle manually |

---

## Online validation tools

### validator.fhir.org

The easiest way to check a bundle without installing anything:

1. Go to [validator.fhir.org](https://validator.fhir.org/)
2. Paste your bundle JSON
3. Select **IG: hl7.fhir.uv.ips** from the Implementation Guide dropdown
4. Click **Validate**

The results are identical to the CLI validator — it runs the same engine.

### Inferno IPS Test Kit

[Inferno](https://inferno.healthit.gov/) provides a comprehensive IPS test suite that validates both the document structure and the server behavior:

1. Go to [inferno.healthit.gov](https://inferno.healthit.gov/)
2. Select the **IPS Test Kit**
3. Point it at your SHL server endpoint
4. Run the test suite

This tests the full workflow: fetching the document, validating its structure, and checking that resources are correctly linked.

---

## CI/CD integration

Automate validation in your build pipeline:

```yaml
# GitHub Actions example
name: Validate IPS Bundle
on: [push, pull_request]

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 17

      - name: Download FHIR Validator
        run: |
          curl -L -o validator_cli.jar \
            https://github.com/hapifhir/org.hl7.fhir.core/releases/latest/download/validator_cli.jar

      - name: Generate test bundle
        run: |
          npm ci
          node scripts/generate-test-bundle.js  # outputs bundle.json

      - name: Validate against IPS profile
        run: |
          java -jar validator_cli.jar bundle.json \
            -ig hl7.fhir.uv.ips \
            -profile http://hl7.org/fhir/uv/ips/StructureDefinition/Bundle-uv-ips \
            -level warnings
```

The `-level warnings` flag causes the validator to exit with a non-zero code if there are warnings or errors (default is errors only).

### SDK-level validation in tests

```typescript
import { describe, it, expect } from "vitest";
import { IPS } from "@fhirfly-io/shl";

describe("IPS Bundle validation", () => {
  it("should produce a valid IPS bundle", async () => {
    const bundle = new IPS.Bundle({
      given: "Test",
      family: "Patient",
      birthDate: "1990-01-01",
      gender: "other",
    });

    bundle.addMedication({
      code: "860975",
      system: "http://www.nlm.nih.gov/research/umls/rxnorm",
      display: "Metformin 500 MG Oral Tablet",
    });

    const result = bundle.validate();
    expect(result.valid).toBe(true);

    const errors = result.issues.filter(i => i.severity === "error");
    expect(errors).toHaveLength(0);
  });
});
```

---

## Validation strategy

For most use cases, a two-tier approach works well:

1. **Always:** Run `bundle.validate()` in your application code before calling `SHL.create()`. This catches the most common issues instantly with no external dependencies.

2. **In CI/CD:** Run the HL7 FHIR Validator against sample bundles to catch deeper profile conformance issues. This is slower (Java startup, IG download) but comprehensive.

3. **Periodically:** Paste a production bundle into [validator.fhir.org](https://validator.fhir.org/) to check for new IPS profile requirements after spec updates.
