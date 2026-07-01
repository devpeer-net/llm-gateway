# LLM Gateway

## Overview

This service was initially implemented for the
[BrowseWiz](https://browsewiz.com) browser extension as a simple, secure and
reliable LLM gateway sitting between clients and upstream model providers. It has
since been generalized and de-branded into a standalone, reusable gateway that
any application can adopt: it presents one stable OpenAI-compatible surface
across multiple providers, and centralizes authentication, quota/credit
accounting and rate limiting behind a single endpoint.

## Key Features

- **OpenAI-compatible API** — a single `POST /v1/chat/completions` endpoint with
  both streaming (SSE) and non-streaming responses.
- **Multi-provider dispatch** — routes to OpenAI, Google Gemini (OpenAI-compat)
  and OpenRouter through one SDK, with per-engine request adaptation.
- **Proxy models with failover** — virtual model ids that round-robin over real
  models and fail over across providers (including an OpenRouter fallback) on
  rate-limit (429) errors; fully config-driven.
- **Pluggable authentication** — generic JWT verification (JWKS, public key or
  shared secret) with optional issuer/audience checks, plus a no-auth mode for
  local/dev.
- **Pluggable quota & credits** — quota, credit accounting and rate limiting
  behind a store abstraction: in-memory by default (no AWS) or DynamoDB for
  production, selected via configuration.
- **Editable model catalog** — models, engines and pricing coefficients live in
  a simple JSON catalog you can tailor to your deployment.
- **Secure & operable** — typed error handling, per-request logging, configurable
  body limits, timeouts and trust-proxy hops.
- **Easy to deploy** — parameterized Elastic Beanstalk + Nginx template and an
  optional Dockerfile; every setting is environment-driven.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/` | none | Liveness → `OK` |
| `GET` | `/health` | none | Liveness → `OK` |
| `POST` | `/v1/chat/completions` | required (unless no-auth mode) | OpenAI-compatible chat completion (streaming & non-streaming) |

## Quick start (local/dev)

```bash
npm install
cp .env.example .env         # set AUTH_MODE=none, QUOTA_STORE=memory, add provider keys
npm run build
npm run start:env            # or: npm run dev
```

With `AUTH_MODE=none` and `QUOTA_STORE=memory` the service runs with no auth and
no AWS — just provide the LLM API keys for the engines you want to use.

```bash
curl -s localhost:3333/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -d '{"model":"gpt-4o-mini","messages":[{"role":"user","content":"Hello!"}]}'
```

## Configuration

Every option is environment-driven; see [.env.example](.env.example) for the full
list. Highlights:

- **Auth** — `AUTH_MODE=jwt` verifies a Bearer JWT against `AUTH_JWKS_URL`,
  `AUTH_JWT_PUBLIC_KEY` or `AUTH_JWT_SECRET` (issuer/audience optional; user id
  from `AUTH_USER_ID_CLAIM`). `AUTH_MODE=none` bypasses auth for local/dev.
- **Quota store** — `QUOTA_STORE=memory` (default, no AWS) or `QUOTA_STORE=dynamodb`
  (requires `API_USAGE_TABLE`, `AWS_REGION`; the AWS SDK is an optional dependency
  loaded only in this mode).
- **Models** — edit [src/llm/costs/costs.json](src/llm/costs/costs.json) to define
  the model catalog and pricing coefficients.
- **Proxy models** — virtual model ids that round-robin over real models with
  cross-provider failover, configured via `PROXY_MODELS_JSON` (defaults in
  [src/config.ts](src/config.ts)).

## Testing

```bash
npm test        # unit/integration suite (no network, no AWS)
npm run e2e     # live verification against real providers (see e2e/README.md)
```

## Deployment

A parameterized Elastic Beanstalk + Nginx template lives in [deploy/](deploy/), plus
an optional [Dockerfile](deploy/Dockerfile). All AWS specifics come from
environment variables — see [deploy/deploy.sh](deploy/deploy.sh).

## License

MIT
