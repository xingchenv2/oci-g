# oci-g

Cloudflare Worker bridge for **OpenAI-compatible** clients (such as **New-API**) to **OCI Generative AI**.

## Supported routes

- `GET /health`
- `GET /v1/models`
- `GET /models`
- `POST /v1/chat/completions`
- `POST /chat/completions`

## Required Cloudflare Worker secrets

Set these in Cloudflare Workers or via Wrangler:

- `WORKER_API_KEY` - API key used for chat requests; model-list requests are intentionally public for compatibility with some panels
- `OCI_USER`
- `OCI_FINGERPRINT`
- `OCI_TENANCY`
- `OCI_REGION`
- `OCI_PRIVATE_KEY` - full PEM text, not a file path
- `OCI_COMPARTMENT_ID` - optional; if omitted, falls back to `OCI_TENANCY`
- `OCI_MODEL_ID` - optional; default model used when the request does not specify `model`
- `OCI_MODELS` - optional; comma-separated or newline-separated model list exposed by `/v1/models`

## Default exposed models

If `OCI_MODELS` is not set, `/v1/models` returns these defaults:

- `cohere.command-a-03-2025 v1.0`
- `cohere.command-a-vision v1.0`
- `cohere.command-latest`
- `cohere.command-plus-latest`
- `cohere.command-r-08-2024 v2.0`
- `cohere.command-r-08-2024 v1.7`
- `cohere.command-r-plus-08-2024 v2.0`
- `cohere.command-r-plus-08-2024 v1.6`
- `google.gemini-2.5-flash`
- `google.gemini-2.5-flash-lite`
- `google.gemini-2.5-pro`
- `meta.llama-3.1-405b-instruct`
- `meta.llama-3.2-90b-vision-instruct`
- `meta.llama-3.3-70b-instruct`
- `meta.llama-4-maverick-17b-128e-instruct-fp8`
- `meta.llama-4-scout-17b-16e-instruct`
- `openai.gpt-oss-120b`
- `openai.gpt-oss-20b`
- `xai.grok-3`
- `xai.grok-3-fast`
- `xai.grok-3-mini`
- `xai.grok-3-mini-fast`
- `xai.grok-4`
- `xai.grok-4-1-fast-non-reasoning`
- `xai.grok-4-1-fast-reasoning`
- `xai.grok-4-fast-non-reasoning`
- `xai.grok-4-fast-reasoning`
- `xai.grok-4.20-0309-non-reasoning`
- `xai.grok-4.20-0309-reasoning`
- `xai.grok-4.20-non-reasoning`
- `xai.grok-4.20-reasoning`
- `xai.grok-4.3`
- `xai.grok-code-fast-1`
- `xai.grok-voice-agent`

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
wrangler secret put OCI_MODELS
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
- **Model**: use any model returned by `/v1/models`

New-API will call:

- `GET /v1/models` (or sometimes model discovery without auth depending on version)
- `POST /v1/chat/completions`

## Notes

- Do **not** pass OCI private keys through New-API request headers.
- Store OCI credentials in Worker secrets only.
- Listing a model in `/v1/models` does **not** guarantee your OCI tenant has permission for it.
- The current bridge now sends OCI **GENERIC** chat format for non-Cohere-style chat models such as Gemini/Llama/Grok/GPT-OSS.
- Cohere-family models may still need a dedicated request-shape branch later if OCI rejects them.
- OCI response shapes may vary slightly by model; if needed, adjust `extractOciText()`.
