# SHL SDK — Live Exercise

Comprehensive integration test that exercises every SDK path against the live FHIRfly API. Serves dual purpose:

1. **Smoke test** — run after deploys to verify the full stack
2. **Living documentation** — shows developers every SDK capability with real clinical codes

## Prerequisites

- Node.js >= 18
- FHIRfly API key with `shl.write` scope ([get one here](https://fhirfly.io/dashboard))
- SHL API routes deployed to the target environment

## Quick Start

```bash
cd fhirfly-shl
npm install

# Run all sections
npx tsx examples/live-exercise/index.ts --api-key <your-key>

# Run with verbose output
npx tsx examples/live-exercise/index.ts --api-key <your-key> --verbose

# Run a single section
npx tsx examples/live-exercise/index.ts --api-key <your-key> --section 1
```

## CLI Options

| Option | Description |
|--------|-------------|
| `--api-key <key>` | FHIRfly API key (or set `FHIRFLY_API_KEY` env var) |
| `--section <1-6>` | Run only one section |
| `--verbose` | Show extra diagnostic output |
| `--skip-cleanup` | Don't revoke SHLs (for manual viewer testing) |

## Sections

### Section 1: IPS Bundle Building (~22 tests)
Builds a comprehensive IPS Bundle using every `add*()` method variant:
- `addMedication()` — byNDC, byRxNorm, bySNOMED (with/without API), fromResource, manual
- `addCondition()` — byICD10, bySNOMED, fromResource, manual
- `addAllergy()` — bySNOMED, fromResource, manual
- `addImmunization()` — byCVX, fromResource, manual
- `addResult()` — byLOINC, fromResource, manual (with value/unit/range)
- `addDocument()` — PDF attachment
- `validate()` and `build()`

### Section 2: FhirflyStorage (5 tests)
Zero-infrastructure SHL creation using FHIRfly's hosted storage:
- `FhirflyStorage` instantiation
- `SHL.create()` with passcode, label, expiration
- QR code generation
- `SHL.decode()` URL parsing
- Content accessible via live API

### Section 3: LocalStorage + Express (7 tests)
Bring-your-own-server path with local filesystem and Express:
- `LocalStorage` + `SHL.create()`
- Express server on random port
- POST manifest endpoint
- GET encrypted content
- `SHL.decrypt()` round-trip
- Wrong passcode → 401
- Server shutdown and cleanup

Skips gracefully if `express` is not installed.

### Section 4: SHL Consumption (7 tests)
Decodes and decrypts SHLs created in sections 2 and 3:
- `SHL.decode()` for both storage types
- `SHL.decrypt()` round-trip
- Patient data preserved (name, birthDate)
- Clinical resource types present
- Composition sections intact
- Viewer URL output

### Section 5: Access Control & Lifecycle (9 tests)
Creates dedicated SHLs for each access control test:
- Passcode: correct → 200, wrong → 401, missing → 401
- Access count: within limit → 200, exceeds → 410
- Expiration: future → 200, past → 410
- `SHL.revoke()` → 404 after revoke
- Revoke is idempotent

### Section 6: Edge Cases (6 tests)
- Large bundle (20 meds, 10 conditions, 5 allergies, 5 immunizations, 5 results)
- Minimal IPS (patient only, no clinical data)
- Invalid NDC — graceful degradation
- Invalid ICD-10 — graceful degradation
- SHL with PDF attachment (manifest has 2 files, decrypt works)
- SHL without passcode (flag is "L", access with empty body)

## Sample Output

```
=== FHIRfly SHL SDK — Live Exercise ===
API: https://devapi.fhirfly.io

--- Section 1: IPS Bundle Building ---
  [PASS]  addMedication — byNDC (product)           142ms
  [PASS]  addMedication — byRxNorm (860975)           98ms
  [PASS]  addMedication — bySNOMED with API            67ms
  ...
  [PASS]  bundle.build()                              312ms

--- Section 2: FhirflyStorage (Zero-Infra) ---
  [PASS]  FhirflyStorage instantiation                  1ms
  [PASS]  SHL.create() with FhirflyStorage            456ms
  ...

=== Summary ===
  Passed: 56/56  |  Failed: 0  |  Skipped: 0  |  Time: 18.7s
```

## Exit Codes

- `0` — All tests passed
- `1` — One or more tests failed

## Environment Variables

| Variable | Description |
|----------|-------------|
| `FHIRFLY_API_KEY` | Alternative to `--api-key` flag |
