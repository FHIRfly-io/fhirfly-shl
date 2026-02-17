#!/usr/bin/env bash
# Downloads the HL7 FHIR Validator CLI jar if not already present.
# Idempotent — safe to call repeatedly.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
VALIDATOR_DIR="$PROJECT_ROOT/.validator"
JAR_PATH="$VALIDATOR_DIR/validator_cli.jar"

if [ -f "$JAR_PATH" ]; then
  echo "✓ Validator already exists at $JAR_PATH"
  exit 0
fi

mkdir -p "$VALIDATOR_DIR"

echo "Downloading HL7 FHIR Validator CLI..."
curl -fSL --progress-bar -o "$JAR_PATH" \
  https://github.com/hapifhir/org.hl7.fhir.core/releases/latest/download/validator_cli.jar

echo "✓ Validator downloaded to $JAR_PATH"
