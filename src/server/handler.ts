// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import type {
  HandlerRequest,
  HandlerResponse,
  SHLHandlerConfig,
} from "./types.js";
import type { SHLMetadata, Manifest } from "../shl/types.js";

/**
 * Create a framework-agnostic SHL request handler.
 *
 * Returns an async function that processes incoming requests and returns
 * responses. This handler implements two routes:
 *
 * - `POST /{shlId}` — Manifest endpoint (validates passcode, checks access limits)
 * - `GET /{shlId}/content` — Content endpoint (serves encrypted JWE)
 *
 * Framework adapters (Express, Fastify, Lambda) translate their native
 * request/response types to/from `HandlerRequest`/`HandlerResponse`.
 *
 * @example
 * ```ts
 * const handle = createHandler({ storage });
 * const response = await handle({
 *   method: "POST",
 *   path: "/abc123",
 *   body: { passcode: "1234" },
 *   headers: { "content-type": "application/json" },
 * });
 * ```
 */
export function createHandler(
  config: SHLHandlerConfig,
): (req: HandlerRequest) => Promise<HandlerResponse> {
  const { storage, onAccess } = config;

  return async (req: HandlerRequest): Promise<HandlerResponse> => {
    // Normalize path: strip leading slash, split into segments
    const path = req.path.replace(/^\/+/, "");
    const segments = path.split("/").filter(Boolean);

    // Route: POST /{shlId} → manifest
    if (segments.length === 1 && req.method === "POST") {
      return handleManifest(segments[0]!, req, storage, onAccess);
    }

    // Route: GET /{shlId}/content → serve encrypted content
    if (segments.length === 2 && segments[1] === "content" && req.method === "GET") {
      return handleContent(segments[0]!, storage);
    }

    // Method not allowed for known paths
    if (segments.length === 1 && req.method !== "POST") {
      return jsonResponse(405, { error: "Method not allowed. Use POST for manifest requests." });
    }
    if (segments.length === 2 && segments[1] === "content" && req.method !== "GET") {
      return jsonResponse(405, { error: "Method not allowed. Use GET for content requests." });
    }

    return jsonResponse(404, { error: "Not found" });
  };
}

async function handleManifest(
  shlId: string,
  req: HandlerRequest,
  storage: SHLHandlerConfig["storage"],
  onAccess?: SHLHandlerConfig["onAccess"],
): Promise<HandlerResponse> {
  // Read manifest to verify the SHL exists
  const manifestRaw = await storage.read(`${shlId}/manifest.json`);
  if (manifestRaw === null) {
    return jsonResponse(404, { error: "SHL not found" });
  }

  // Atomically check access control + increment counter
  let updatedMetadata: SHLMetadata | null = null;
  let accessDeniedReason: "expired" | "exhausted" | "passcode" | null = null;
  const reqBody = (req.body && typeof req.body === "object" ? req.body : {}) as Record<string, unknown>;
  const providedPasscode = typeof reqBody["passcode"] === "string" ? reqBody["passcode"] : undefined;

  updatedMetadata = await storage.updateMetadata(shlId, (metadata) => {
    // Check expiration
    if (metadata.expiresAt) {
      const expiresAt = new Date(metadata.expiresAt);
      if (expiresAt.getTime() <= Date.now()) {
        accessDeniedReason = "expired";
        return null;
      }
    }

    // Check access count
    const currentCount = metadata.accessCount ?? 0;
    if (metadata.maxAccesses !== undefined && currentCount >= metadata.maxAccesses) {
      accessDeniedReason = "exhausted";
      return null;
    }

    // Check passcode
    if (metadata.passcode) {
      if (!providedPasscode || providedPasscode !== metadata.passcode) {
        accessDeniedReason = "passcode";
        return null;
      }
    }

    // Access granted — increment count
    return {
      ...metadata,
      accessCount: currentCount + 1,
    };
  });

  // Handle access control failures
  if (accessDeniedReason === "expired") {
    return jsonResponse(410, { error: "SHL has expired" });
  }
  if (accessDeniedReason === "exhausted") {
    return jsonResponse(410, { error: "SHL access limit reached" });
  }
  if (accessDeniedReason === "passcode") {
    return jsonResponse(401, { error: "Invalid passcode" });
  }

  // If updateMetadata returned null but no denied reason, metadata file is missing
  if (updatedMetadata === null) {
    return jsonResponse(404, { error: "SHL not found" });
  }

  // Fire access event (non-blocking)
  if (onAccess) {
    const event = {
      shlId,
      accessCount: updatedMetadata.accessCount ?? 1,
      timestamp: new Date(),
    };
    // Fire and forget — don't let callback errors break the response
    Promise.resolve(onAccess(event)).catch(() => {});
  }

  // Return manifest
  const manifestStr = typeof manifestRaw === "string"
    ? manifestRaw
    : new TextDecoder().decode(manifestRaw);
  const manifest = JSON.parse(manifestStr) as Manifest;

  return jsonResponse(200, manifest);
}

async function handleContent(
  shlId: string,
  storage: SHLHandlerConfig["storage"],
): Promise<HandlerResponse> {
  const content = await storage.read(`${shlId}/content.jwe`);
  if (content === null) {
    return jsonResponse(404, { error: "Content not found" });
  }

  const body = typeof content === "string"
    ? content
    : new TextDecoder().decode(content);

  return {
    status: 200,
    headers: {
      "content-type": "application/jose",
      "cache-control": "no-store",
    },
    body,
  };
}

function jsonResponse(status: number, body: unknown): HandlerResponse {
  return {
    status,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
    },
    body: JSON.stringify(body),
  };
}
