// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import type { Command } from "commander";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { createHandler } from "../server/handler.js";
import { ServerLocalStorage } from "../server/storage.js";

export function registerServeCommand(program: Command): void {
  program
    .command("serve")
    .description("Start a local HTTP server for serving SMART Health Links")
    .option("--port <port>", "Port to listen on", "3456")
    .option("--dir <path>", "Directory containing SHL files", "./shl-data")
    .action(async (opts: { port: string; dir: string }) => {
      const port = parseInt(opts.port, 10);
      const dir = resolve(opts.dir);
      const baseUrl = `http://localhost:${port}/shl`;

      const storage = new ServerLocalStorage({
        directory: dir,
        baseUrl,
      });

      const handler = createHandler({
        storage,
        onAccess: (event) => {
          console.log(`[${new Date().toISOString()}] Access: ${event.shlId} (count: ${event.accessCount})`);
        },
      });

      const server = createServer(async (req, res) => {
        const url = new URL(req.url ?? "/", `http://localhost:${port}`);
        const path = url.pathname;

        // Strip /shl prefix
        if (!path.startsWith("/shl")) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Not found" }));
          return;
        }

        const shlPath = path.slice(4); // Remove "/shl"

        // Read body for POST requests
        let body: unknown;
        if (req.method === "POST") {
          const chunks: Buffer[] = [];
          for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
          }
          try {
            body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          } catch {
            body = undefined;
          }
        }

        // Build headers map
        const headers: Record<string, string | undefined> = {};
        for (const [key, value] of Object.entries(req.headers)) {
          headers[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
        }

        try {
          const response = await handler({
            method: req.method ?? "GET",
            path: shlPath,
            body,
            headers,
          });

          const responseHeaders: Record<string, string> = { ...response.headers };
          res.writeHead(response.status, responseHeaders);

          if (response.body instanceof Uint8Array) {
            res.end(Buffer.from(response.body));
          } else {
            res.end(response.body);
          }
        } catch (err) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Internal server error" }));
          console.error("Handler error:", err);
        }
      });

      server.listen(port, () => {
        console.log(`\x1b[32m✓ SHL server running\x1b[0m`);
        console.log(`  URL:  ${baseUrl}`);
        console.log(`  Dir:  ${dir}`);
        console.log(`  Port: ${port}`);
        console.log(`\nTest with:`);
        console.log(`  curl -X POST ${baseUrl}/<shlId>`);
        console.log(`\nPress Ctrl+C to stop`);
      });
    });
}
