# Serving SMART Health Links

This guide covers setting up a server to serve encrypted SHL content to viewers who scan the QR code.

**Prerequisites:** You've already [created an SHL](./guide-create.md) with encrypted content stored locally or in S3.

---

## How it works

When a viewer scans the QR code, their app:

1. Decodes the `shlink:/` URL to get the manifest endpoint
2. POSTs to the manifest endpoint (with passcode if required)
3. Receives a manifest listing available encrypted files
4. GETs each encrypted file

The SDK provides framework adapters so you don't have to implement the SHL protocol yourself.

![SHL Pipeline](https://assets.fhirfly.io/diagrams/shl-pipeline.svg)

---

## Express

```typescript
import express from "express";
import { expressMiddleware } from "@fhirfly-io/shl/express";
import { ServerLocalStorage } from "@fhirfly-io/shl/server";

const storage = new ServerLocalStorage({
  directory: "./shl-data",
  baseUrl: "http://localhost:3000/shl",
});

const app = express();
app.use(express.json());
app.use("/shl", expressMiddleware({ storage }));
app.listen(3000);
```

---

## Fastify

```typescript
import Fastify from "fastify";
import { fastifyPlugin } from "@fhirfly-io/shl/fastify";
import { ServerLocalStorage } from "@fhirfly-io/shl/server";

const storage = new ServerLocalStorage({
  directory: "./shl-data",
  baseUrl: "http://localhost:3000/shl",
});

const app = Fastify();
app.register(fastifyPlugin({ storage }), { prefix: "/shl" });
app.listen({ port: 3000 });
```

---

## AWS Lambda

```typescript
import { lambdaHandler } from "@fhirfly-io/shl/lambda";
import { ServerS3Storage } from "@fhirfly-io/shl/server";

export const handler = lambdaHandler({
  storage: new ServerS3Storage({
    bucket: "my-shl-bucket",
    region: "us-east-1",
    baseUrl: "https://shl.example.com",
  }),
  pathPrefix: "/shl",
});
```

For Lambda deployments, use `ServerS3Storage` instead of `ServerLocalStorage` — Lambda functions don't have persistent local filesystems.

---

## Server routes

The middleware/plugin handles two routes automatically:

| Route | Method | What it does |
|-------|--------|--------------|
| `/{shlId}` | POST | Validates passcode, checks expiration/access limits, returns manifest |
| `/{shlId}/content` | GET | Returns the encrypted JWE with `Content-Type: application/jose` |

### Manifest request

```bash
curl -X POST http://localhost:3000/shl/{id} \
  -H "Content-Type: application/json" \
  -d '{"passcode":"1234"}'
```

Response:
```json
{
  "files": [
    {
      "contentType": "application/fhir+json",
      "location": "http://localhost:3000/shl/{id}/content"
    }
  ]
}
```

### Access control

The server enforces the access controls you set when creating the SHL:

| Control | Set at creation | Server behavior |
|---------|----------------|-----------------|
| Passcode | `passcode: "1234"` | Returns 401 if passcode doesn't match |
| Expiration | `expiresAt: new Date(...)` | Returns 410 (Gone) after expiration |
| Max accesses | `maxAccesses: 10` | Returns 410 after limit reached |

---

## Storage backends

### ServerLocalStorage

For development and single-server deployments. Reads files from the local filesystem.

```typescript
import { ServerLocalStorage } from "@fhirfly-io/shl/server";

const storage = new ServerLocalStorage({
  directory: "./shl-data",      // Same directory used by SHL.LocalStorage during creation
  baseUrl: "http://localhost:3000/shl",
});
```

### ServerS3Storage

For production and multi-server deployments. Reads files from an S3 bucket.

```typescript
import { ServerS3Storage } from "@fhirfly-io/shl/server";

const storage = new ServerS3Storage({
  bucket: "my-shl-bucket",
  region: "us-east-1",
  baseUrl: "https://shl.example.com",
  prefix: "shl/",              // Optional key prefix in the bucket
});
```

Requires `@aws-sdk/client-s3` as a peer dependency:
```bash
npm install @aws-sdk/client-s3
```

### Framework-agnostic handler

If you're using a framework not covered by the adapters, use `createHandler` directly:

```typescript
import { createHandler } from "@fhirfly-io/shl/server";

const handler = createHandler({ storage });

// handler.handleManifest(shlId, body) — returns { status, body }
// handler.handleContent(shlId)        — returns { status, body, contentType }
```

---

## Checkpoint

Test your server is working:

```bash
curl -X POST http://localhost:3000/shl/{id} \
  -H "Content-Type: application/json" \
  -d '{"passcode":"1234"}'
```

You should get a JSON manifest with a `files` array. Then fetch the content:

```bash
curl http://localhost:3000/shl/{id}/content
```

You should get an opaque JWE string (starts with `eyJ`).

---

## Next: Consume the SHL

Your server is serving encrypted content. Next, [verify the round-trip](./guide-consume.md) by decoding and decrypting the SHL.
