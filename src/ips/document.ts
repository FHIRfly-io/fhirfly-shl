// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
/**
 * Internal document resolution — wraps binary content (PDF, TIFF, JPG, etc.)
 * as FHIR DocumentReference + Binary resource pairs.
 */

import { documentNarrative } from "./narrative.js";
import type { DocumentOptions } from "./types.js";

/** Result of resolving all documents. */
export interface DocumentResolutionResult {
  entries: Array<{ fullUrl: string; resource: Record<string, unknown> }>;
}

/**
 * Resolve all document inputs into FHIR DocumentReference + Binary Bundle entries.
 */
export function resolveDocuments(
  documents: DocumentOptions[],
  patientRef: string,
  profile: "ips" | "r4",
  generateUuid: () => string,
): DocumentResolutionResult {
  const entries: Array<{ fullUrl: string; resource: Record<string, unknown> }> = [];

  for (const doc of documents) {
    const binaryId = generateUuid();
    const docRefId = generateUuid();
    const binaryFullUrl = `urn:uuid:${binaryId}`;
    const docRefFullUrl = `urn:uuid:${docRefId}`;

    const contentType = doc.contentType ?? "application/pdf";
    const date = doc.date ?? new Date().toISOString().split("T")[0]!;

    // Build Binary resource
    const base64Content = bufferToBase64(doc.content);
    const binaryResource: Record<string, unknown> = {
      resourceType: "Binary",
      id: binaryId,
      contentType,
      data: base64Content,
    };

    // Build DocumentReference resource
    const typeCode = doc.typeCode ?? "34133-9";
    const typeDisplay = doc.typeDisplay ?? "Summarization of episode note";

    const docRefResource: Record<string, unknown> = {
      resourceType: "DocumentReference",
      id: docRefId,
      status: "current",
      type: {
        coding: [
          {
            system: "http://loinc.org",
            code: typeCode,
            display: typeDisplay,
          },
        ],
      },
      subject: { reference: patientRef },
      date,
      content: [
        {
          attachment: {
            contentType,
            url: binaryFullUrl,
            title: doc.title,
          },
        },
      ],
    };

    if (profile === "ips") {
      docRefResource.meta = {
        profile: ["http://hl7.org/fhir/uv/ips/StructureDefinition/DocumentReference-uv-ips"],
      };
    }

    docRefResource.text = {
      status: "generated",
      div: documentNarrative(doc.title, contentType, doc.date),
    };

    // DocumentReference first, then Binary
    entries.push({ fullUrl: docRefFullUrl, resource: docRefResource });
    entries.push({ fullUrl: binaryFullUrl, resource: binaryResource });
  }

  return { entries };
}

/** Convert Buffer or Uint8Array to base64 string. */
function bufferToBase64(data: Buffer | Uint8Array): string {
  if (Buffer.isBuffer(data)) {
    return data.toString("base64");
  }
  return Buffer.from(data).toString("base64");
}
