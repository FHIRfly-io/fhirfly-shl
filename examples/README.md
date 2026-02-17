# Examples

## demo.ts

```bash
# Local storage (default) — no network needed
npx tsx examples/demo.ts

# S3 storage — requires AWS credentials + @aws-sdk/client-s3
npx tsx examples/demo.ts --s3 --bucket my-shl-bucket --region us-east-1 --base-url https://shl.example.com
```
