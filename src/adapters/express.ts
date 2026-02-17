// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import { createHandler } from "../server/handler.js";
import type { SHLHandlerConfig, HandlerRequest } from "../server/types.js";

// Minimal Express types — avoids requiring @types/express at runtime
interface ExpressRequest {
  method: string;
  path: string;
  body?: unknown;
  headers: Record<string, string | string[] | undefined>;
}

interface ExpressResponse {
  status(code: number): ExpressResponse;
  set(headers: Record<string, string>): ExpressResponse;
  send(body: string | Buffer): void;
}

/**
 * Create an Express-compatible middleware for serving SMART Health Links.
 *
 * Mount this on the path prefix where your SHL server lives. The middleware
 * handles `POST /:shlId` (manifest) and `GET /:shlId/content` (encrypted content).
 *
 * @example
 * ```ts
 * import express from "express";
 * import { expressMiddleware } from "@fhirfly-io/shl/express";
 * import { ServerLocalStorage } from "@fhirfly-io/shl/server";
 *
 * const app = express();
 * app.use(express.json());
 * app.use("/shl", expressMiddleware({
 *   storage: new ServerLocalStorage({
 *     directory: "./shl-data",
 *     baseUrl: "https://shl.example.com",
 *   }),
 * }));
 * ```
 */
export function expressMiddleware(
  config: SHLHandlerConfig,
): (req: ExpressRequest, res: ExpressResponse) => void {
  const handle = createHandler(config);

  return (req: ExpressRequest, res: ExpressResponse): void => {
    const handlerReq: HandlerRequest = {
      method: req.method,
      path: req.path,
      body: req.body,
      headers: normalizeHeaders(req.headers),
    };

    handle(handlerReq)
      .then((result) => {
        res.status(result.status).set(result.headers).send(
          typeof result.body === "string" ? result.body : Buffer.from(result.body),
        );
      })
      .catch(() => {
        res.status(500).set({ "content-type": "application/json" }).send(
          JSON.stringify({ error: "Internal server error" }),
        );
      });
  };
}

function normalizeHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
  }
  return result;
}
