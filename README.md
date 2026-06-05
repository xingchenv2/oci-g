# oci-g

Cloudflare Worker bridge for **OpenAI-compatible** clients (such as **New-API**) to **OCI Generative AI**.

## Supported routes

- `GET /health`
- `GET /v1/models`
- `POST /v1/chat/completions`
- `POST /chat/completions`

## Required Cloudflare Worker secrets

Set these in Cloudflare Workers or via Wrangler:

- `WORKER_API_KEY` - API key that New-API will send as `Bearer ...`
- `OCI_USER`
- `OCI_FINGERPRINT`
- `OCI_TENANCY`
- `OCI_REGION`
- `OCI_PRIVATE_KEY` - full PEM text, not a file path
- `OCI_COMPARTMENT_ID` - optional; if omitted, falls back to `OCI_TENANCY`
- `OCI_MODEL_ID` - optional; defaults to `google.gemini-2.5-pro`

## Example Wrangler commands

```bash
wrangler secret put WORKER_API_KEY
wrangler secret put OCI_USER
wrangler secret put OCI_FINGERPRINT
wrangler secret put OCI_TENANCY
wrangler secret put OCI_REGION
wrangler secret put OCI_PRIVATE_KEY
wrangler secret put OCI_COMPARTMENT_ID
wrangler secret put OCI_MODEL_ID
```

## Example `wrangler.toml`

```toml
name = "oci-openai-bridge"
main = "index.js"
compatibility_date = "2026-06-05"
workers_dev = true
```

## New-API panel configuration

Create an **OpenAI** channel in New-API:

- **Base URL**: `https://<your-worker-domain>`
- **API Key**: same value as `WORKER_API_KEY`
- **Model**: `google.gemini-2.5-pro` (or your configured OCI model)

New-API will call:

- `GET /v1/models`
- `POST /v1/chat/completions`

## Notes

- Do **not** pass OCI private keys through New-API request headers.
- Store OCI credentials in Worker secrets only.
- OCI response shapes may vary slightly by model; if needed, adjust `extractOciText()`.
