import { createHandler } from "../server/handler.js";
import type { SHLHandlerConfig, HandlerRequest } from "../server/types.js";

// Minimal Fastify types — avoids requiring fastify at runtime
interface FastifyRequest {
  method: string;
  body?: unknown;
  params: Record<string, string>;
  headers: Record<string, string | string[] | undefined>;
}

interface FastifyReply {
  status(code: number): FastifyReply;
  headers(headers: Record<string, string>): FastifyReply;
  send(body: string | Buffer): void;
}

interface FastifyInstance {
  post(
    path: string,
    handler: (req: FastifyRequest, reply: FastifyReply) => Promise<void>,
  ): void;
  get(
    path: string,
    handler: (req: FastifyRequest, reply: FastifyReply) => Promise<void>,
  ): void;
}

type FastifyDone = (err?: Error) => void;

/**
 * Create a Fastify plugin for serving SMART Health Links.
 *
 * Register this plugin with a prefix to mount the SHL routes.
 * The plugin registers `POST /:shlId` and `GET /:shlId/content`.
 *
 * @example
 * ```ts
 * import Fastify from "fastify";
 * import { fastifyPlugin } from "@fhirfly-io/shl/fastify";
 * import { ServerLocalStorage } from "@fhirfly-io/shl/server";
 *
 * const app = Fastify();
 * app.register(fastifyPlugin({
 *   storage: new ServerLocalStorage({
 *     directory: "./shl-data",
 *     baseUrl: "https://shl.example.com",
 *   }),
 * }), { prefix: "/shl" });
 * ```
 */
export function fastifyPlugin(
  config: SHLHandlerConfig,
): (fastify: FastifyInstance, opts: unknown, done: FastifyDone) => void {
  const handle = createHandler(config);

  return (fastify: FastifyInstance, _opts: unknown, done: FastifyDone): void => {
    // POST /:shlId — manifest endpoint
    fastify.post("/:shlId", async (req: FastifyRequest, reply: FastifyReply) => {
      const shlId = req.params["shlId"] ?? "";
      const handlerReq: HandlerRequest = {
        method: "POST",
        path: `/${shlId}`,
        body: req.body,
        headers: normalizeHeaders(req.headers),
      };

      const result = await handle(handlerReq);
      reply.status(result.status).headers(result.headers).send(
        typeof result.body === "string" ? result.body : Buffer.from(result.body),
      );
    });

    // GET /:shlId/content — content endpoint
    fastify.get("/:shlId/content", async (req: FastifyRequest, reply: FastifyReply) => {
      const shlId = req.params["shlId"] ?? "";
      const handlerReq: HandlerRequest = {
        method: "GET",
        path: `/${shlId}/content`,
        body: undefined,
        headers: normalizeHeaders(req.headers),
      };

      const result = await handle(handlerReq);
      reply.status(result.status).headers(result.headers).send(
        typeof result.body === "string" ? result.body : Buffer.from(result.body),
      );
    });

    done();
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
