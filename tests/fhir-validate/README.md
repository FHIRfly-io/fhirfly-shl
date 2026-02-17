# FHIR Validation Tests

Automated FHIR validation using the HL7 FHIR Validator CLI to guarantee SDK output
is valid FHIR against R4 and IPS profiles.

## Prerequisites

- **Java 21+** — required by the validator CLI
- **Validator JAR** — downloaded automatically by the setup script (~178MB)
- **`@fhirfly-io/terminology`** — installed as devDependency for live API tests

## Running Tests

```bash
# Run all validation tests (downloads validator on first run)
npm run test:validate

# Run with live FHIRfly API tests (requires API key)
FHIRFLY_API_KEY=ffly_live_xxx npm run test:validate

# Run only the regular fast tests (validation tests auto-skip)
npm test
```

## Test Structure

The test file (`fhir-validate.test.ts`) is organized into 7 sections:

| Section | Tests | Description |
|---------|-------|-------------|
| 1. Structural | 4 | Minimal bundles, full patient demographics |
| 2. Terminology (manual) | 4 | Real codes with tx.fhir.org-validated display names |
| 3. Enrichment (mock) | 5 | Mock FhirflyClient testing all enrichment paths |
| 4. fromResource | 1 | Passthrough of pre-built FHIR resources |
| 5. P1 Regressions | 3 | bdl-9, effectiveDateTime, LOINC display fixes |
| 6. Negative | 2 | Intentionally invalid bundles |
| 7. Live API | 6 | Real FHIRfly API enrichment (requires API key) |

### Graceful Skipping

- **No Java/JAR**: All validation tests skip (Sections 1-7)
- **No API key**: Only Section 7 (live API) skips; Sections 1-6 still run
- **Normal `npm test`**: All validation tests skip (JAR not present by default)

## How It Works

1. **`setup-validator.sh`** downloads `validator_cli.jar` from the HL7 GitHub releases
2. **`fhir-validator.ts`** provides TypeScript helpers:
   - `isValidatorAvailable()` — checks for JAR + Java
   - `validateBundles(bundles, { profile })` — writes bundles to temp files, runs
     `java -jar validator_cli.jar` per bundle, parses OperationOutcome JSON
3. **`fhir-validate.test.ts`** builds bundles in `beforeAll`, validates in batch,
   then each `it()` asserts on pre-computed results (fast after initial validation)

### Validator Invocation

Each bundle is validated individually to attribute errors correctly:

```
java -jar .validator/validator_cli.jar <file.json> \
  -version 4.0 \
  -output <result.json> \
  [-ig hl7.fhir.uv.ips]   # only for IPS profile
```

The validator uses `tx.fhir.org` as the terminology server to validate display names
against official code systems (RxNorm, SNOMED, ICD-10-CM, CVX, LOINC).

## Live API Tests (Section 7)

These tests use the real `@fhirfly-io/terminology` npm SDK to make actual API calls,
then validate the resulting FHIR bundles. This tests the full pipeline: user code →
SDK enrichment → FHIRfly API → FHIR bundle → HL7 validator.

### Setup

1. The SDK is already installed as a devDependency:
   ```bash
   npm install --save-dev @fhirfly-io/terminology
   ```

2. Get an API key from https://fhirfly.io/dashboard:
   - Sign up / log in
   - Go to Dashboard → Credentials
   - Create a new credential
   - Copy the API key (starts with `ffly_`)

3. Run with the key:
   ```bash
   FHIRFLY_API_KEY=ffly_live_xxx npm run test:validate
   ```

### How the SDK is Incorporated

The SHL SDK defines a duck-typed `FhirflyClient` interface in `src/ips/types.ts`.
Any object matching that shape works — including the `Fhirfly` class from
`@fhirfly-io/terminology`. The test creates a real client:

```typescript
import { Fhirfly } from "@fhirfly-io/terminology";

const fhirfly = new Fhirfly({ apiKey: process.env.FHIRFLY_API_KEY });

const bundle = new IPS.Bundle(patient);
bundle.addMedication({ byRxNorm: "314076", fhirfly, status: "active" });
bundle.addCondition({ byICD10: "E11.9", fhirfly, clinicalStatus: "active" });
```

## Adding New Tests

### Adding a mock test (Sections 1-6)

1. Build the bundle in `beforeAll`:
   ```typescript
   const myBundle = new IPS.Bundle(shorthandPatient);
   myBundle.addMedication({ code: "...", system: "...", display: "...", status: "active" });
   bundles.set("my-test-ips", await myBundle.build({
     profile: "ips",
     compositionDate: FIXED_DATE,
   }));
   ```

2. Add an `it()` block in the appropriate section:
   ```typescript
   it("my test description", () => {
     expectValid("my-test-ips", ipsResults);
   });
   ```

3. For R4 tests, use the `-r4` suffix and assert against `r4Results`.

### Adding a live API test (Section 7)

1. Build the bundle using `fhirfly` (the real client):
   ```typescript
   const myBundle = new IPS.Bundle(livePatient);
   myBundle.addMedication({ byRxNorm: "314076", fhirfly, status: "active" });
   bundles.push({
     name: "live-my-test",
     bundle: await myBundle.build({ profile: "ips", compositionDate: FIXED_DATE }),
   });
   ```

2. Add an `it()`:
   ```typescript
   it("my live test description", () => {
     expectValid("live-my-test");
   });
   ```

### Tips

- **Display names matter**: tx.fhir.org validates display strings against canonical
  values. Use exact canonical displays or the validator will error.
- **Use FIXED_DATE**: Avoids non-determinism from `new Date()`.
- **Timeout**: `beforeAll` has a 600s timeout — first run downloads IPS IG packages
  to `~/.fhir/` (cached for subsequent runs).
- **dom-6 warnings**: The "narrative for robust management" warnings are expected —
  the SDK doesn't generate narrative text (it's a best practice, not a requirement).

## File Layout

```
tests/fhir-validate/
├── README.md              # This file
├── setup-validator.sh     # Downloads validator_cli.jar
├── fhir-validator.ts      # TypeScript helper (validateBundles, isValidatorAvailable)
└── fhir-validate.test.ts  # All test cases (7 sections)

.validator/                # Git-ignored
├── validator_cli.jar      # HL7 FHIR Validator (~178MB)
└── tmp/                   # Temp files during validation (auto-cleaned)
```
