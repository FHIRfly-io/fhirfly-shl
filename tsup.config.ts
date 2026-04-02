// Copyright 2026 FHIRfly.io LLC. All rights reserved.
// Licensed under the MIT License. See LICENSE file in the project root.
import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    server: "src/server/index.ts",
    express: "src/adapters/express.ts",
    fastify: "src/adapters/fastify.ts",
    lambda: "src/adapters/lambda.ts",
    cli: "src/cli/index.ts",
  },
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  sourcemap: false,
  splitting: true,
  treeshake: true,
  minify: false,
  target: "node18",
  external: ["@aws-sdk/client-s3", "@azure/storage-blob", "@google-cloud/storage"],
});
