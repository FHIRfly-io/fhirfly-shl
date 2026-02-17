// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import { createHandler } from "../server/handler.js";
import type { SHLHandlerConfig, HandlerRequest } from "../server/types.js";

// Inline API Gateway v2 types — no @types/aws-lambda dependency needed
interface APIGatewayProxyEventV2 {
  requestContext: {
    http: {
      method: string;
      path: string;
    };
  };
  headers: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
}

interface APIGatewayProxyResultV2 {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  isBase64Encoded?: boolean;
}

export interface LambdaHandlerConfig extends SHLHandlerConfig {
  /**
   * Path prefix to strip from the incoming event path.
   *
   * For example, if your API Gateway route is `/shl/{proxy+}`,
   * set `pathPrefix: "/shl"` so that `/shl/abc123` becomes `/abc123`.
   */
  pathPrefix?: string;
}

/**
 * Create an AWS Lambda handler for serving SMART Health Links.
 *
 * Designed for API Gateway v2 (HTTP API) event format. Strips the
 * optional `pathPrefix` from the incoming path before routing.
 *
 * @example
 * ```ts
 * import { lambdaHandler } from "@fhirfly-io/shl/lambda";
 * import { ServerS3Storage } from "@fhirfly-io/shl/server";
 *
 * export const handler = lambdaHandler({
 *   storage: new ServerS3Storage({
 *     bucket: "my-shl-bucket",
 *     region: "us-east-1",
 *     baseUrl: "https://shl.example.com",
 *   }),
 *   pathPrefix: "/shl",
 * });
 * ```
 */
export function lambdaHandler(
  config: LambdaHandlerConfig,
): (event: APIGatewayProxyEventV2) => Promise<APIGatewayProxyResultV2> {
  const handle = createHandler(config);
  const prefix = config.pathPrefix?.replace(/\/+$/, "") ?? "";

  return async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
    // Strip path prefix
    let path = event.requestContext.http.path;
    if (prefix && path.startsWith(prefix)) {
      path = path.slice(prefix.length) || "/";
    }

    // Parse body
    let body: unknown;
    if (event.body) {
      try {
        const raw = event.isBase64Encoded
          ? Buffer.from(event.body, "base64").toString("utf8")
          : event.body;
        body = JSON.parse(raw);
      } catch {
        body = undefined;
      }
    }

    const handlerReq: HandlerRequest = {
      method: event.requestContext.http.method,
      path,
      body,
      headers: normalizeHeaders(event.headers),
    };

    try {
      const result = await handle(handlerReq);

      // Binary bodies (Uint8Array) need base64 encoding
      if (result.body instanceof Uint8Array) {
        return {
          statusCode: result.status,
          headers: result.headers,
          body: Buffer.from(result.body).toString("base64"),
          isBase64Encoded: true,
        };
      }

      return {
        statusCode: result.status,
        headers: result.headers,
        body: result.body,
      };
    } catch {
      return {
        statusCode: 500,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ error: "Internal server error" }),
      };
    }
  };
}

function normalizeHeaders(
  headers: Record<string, string | undefined>,
): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    result[key.toLowerCase()] = value;
  }
  return result;
}
