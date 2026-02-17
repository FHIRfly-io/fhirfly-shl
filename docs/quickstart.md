# SMART Health Links SDK — Quickstart

> **This guide has been restructured.** The content is now split into focused pages:

## Start here

**[Overview](./overview.md)** — What SHL is, key concepts (IPS, SHL protocol, manifest mode, JWE), install instructions, package structure, and security model.

## Guides

1. **[Creating a SMART Health Link](./guide-create.md)** — Build a FHIR IPS Bundle, validate it, encrypt it, and generate a QR code
2. **[Serving SMART Health Links](./guide-serve.md)** — Set up Express, Fastify, or Lambda to serve encrypted content to viewers
3. **[Consuming SMART Health Links](./guide-consume.md)** — Decode the `shlink:/` URL, fetch the manifest, and decrypt the FHIR content

## Additional resources

- **[Validation Guide](./validation.md)** — Deep-dive on FHIR validation: SDK `validate()`, HL7 FHIR Validator, online tools
- [SMART Health Links Specification](https://docs.smarthealthit.org/smart-health-links/spec/)
- [IPS Implementation Guide](https://build.fhir.org/ig/HL7/fhir-ips/)
- [CommonHealth SHL Viewer](https://viewer.commonhealth.org/)
