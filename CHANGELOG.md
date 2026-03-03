# Changelog

All notable changes to this project will be documented in this file.

## [0.5.0] - 2026-03-03

### Added
- **Expiration presets**: `SHL.create({ expiresAt: "point-of-care" })` resolves to 15 minutes, `"appointment"` → 24 hours, `"travel"` → 90 days, `"permanent"` → no expiration. Raw `Date` passthrough still works.
- **`AuditableStorage` interface**: extends `SHLServerStorage` with `onAccess(shlId, event)` for storage-level audit logging. Opt-in — existing implementations work unchanged.
- **`isAuditableStorage()` type guard**: detect auditable storage at runtime
- **PSHD `meta.profile` stripping**: `build({ profile: "pshd" })` now strips `meta.profile` from all resources in the bundle per PSHD spec
- Exported `ExpirationPreset` type and `EXPIRATION_PRESETS` map from `SHL` namespace

### Changed
- `SHLOptions.expiresAt` now accepts `Date | ExpirationPreset` (additive, non-breaking)

## [0.4.0] - 2026-03-03

### Added
- PSHD compliance preset (`compliance: "pshd"`) enforcing direct mode, required expiration, and forbidden passcode
- SHL direct mode (flag U) — GET-based retrieval without manifest
- PSHD-specific Patient resource handling (no `meta.profile`)
- PSHD DocumentReference constraints: CMS category, PATAST security label, Patient author, 60591-5 type
- Direct access handler route (`GET /{shlId}`)
- Access control for direct mode (expiration, access count)
- `onAccess` callback fires for both manifest and direct access modes
- `recipient` query parameter passthrough to `onAccess` event

## [0.3.2] - 2026-03-02

### Changed
- Migrated repository URLs from GitHub to GitLab

## [0.3.1] - 2026-02-19

### Fixed
- Used `crypto.randomUUID()` instead of `Math.random()` for FHIR resource IDs
- Added CORS headers to server handler for browser-based SHL viewers
- Fixed missing attachment route in Fastify adapter
- Fixed conditional writes JSDoc

## [0.3.0] - 2026-02-19

### Added
- Manifest `lastUpdated` field and `status` field per SHL spec
- Embedded JWE support in manifest entries
- `SHL.getEntryContent()` helper for transparent location/embedded handling
- `--api-base-url` CLI option for production testing

### Fixed
- Debug mode `NODE_ENV=production` guard
- Content-Type now includes `fhirVersion=4.0.1`
- Hardened passcode comparison (timing-safe SHA-256)

## [0.2.0] - 2026-02-18

### Added
- `addResult()` for lab Observations (LOINC-coded)
- `addDocument()` for PDF/binary attachments wrapped as DocumentReference + Binary
- Cloud storage adapters: `S3Storage`, `AzureStorage`, `GCSStorage`, `FhirflyStorage`
- CLI tool (`fhirfly-shl`)
- Comprehensive integration test suite (55 tests)

## [0.1.1] - 2026-02-18

### Added
- Initial public release
- IPS Bundle builder: `addMedication()`, `addCondition()`, `addAllergy()`, `addImmunization()`
- SHL creation with JWE encryption (AES-256-GCM)
- QR code generation (PNG data URI)
- Local filesystem storage
- Server handler with manifest endpoint, passcode validation, access control
- Express and Fastify adapter middleware
- Lambda handler adapter
- Multi-file manifest support with PDF/binary attachments
- SHL revocation support

[0.5.0]: https://gitlab.com/fhirfly-io/fhirfly-shl/-/compare/v0.4.0...v0.5.0
[0.4.0]: https://gitlab.com/fhirfly-io/fhirfly-shl/-/compare/v0.3.2...v0.4.0
[0.3.2]: https://gitlab.com/fhirfly-io/fhirfly-shl/-/compare/v0.3.1...v0.3.2
[0.3.1]: https://gitlab.com/fhirfly-io/fhirfly-shl/-/compare/v0.3.0...v0.3.1
[0.3.0]: https://gitlab.com/fhirfly-io/fhirfly-shl/-/compare/v0.2.0...v0.3.0
[0.2.0]: https://gitlab.com/fhirfly-io/fhirfly-shl/-/compare/v0.1.1...v0.2.0
[0.1.1]: https://gitlab.com/fhirfly-io/fhirfly-shl/-/releases/v0.1.1
