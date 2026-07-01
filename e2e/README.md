# Client end-to-end verification

A standalone, opt-in harness (separate from `npm test`) that validates a real
local deployment of the gateway against live LLM providers.

## What it does

1. Boots the service in-process with `AUTH_MODE=none` and `QUOTA_STORE=memory`
   (no AWS, no credentials beyond LLM tokens).
2. Runs a short prompt suite ([`prompts.ts`](./prompts.ts)) spanning multiple
   models across all three engines (OpenAI, Gemini, OpenRouter), including a
   **proxy model** and a **streaming** request.
3. Asserts each request returns HTTP 200 with a non-empty assistant message and
   prints a per-model pass/fail/skip summary.

## Supplying tokens

Add the provider keys you want to exercise to a `.env` file at the repo root:

```
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
OPENROUTER_API_KEY=sk-or-...
```

Any prompt whose required key is **absent is skipped** with an explanatory log
line — the run still succeeds for the available models.

## Running

```
npm run e2e
```

Exits non-zero if any non-skipped prompt fails.
