/**
 * Error forwarding e2e tests.
 *
 * Verifies the gateway proxies upstream API errors (status code + body)
 * directly, instead of replacing them with gateway-invented messages.
 *
 * Strategy: boot the gateway with deliberately invalid provider API keys so
 * every upstream call is rejected at the provider's auth layer.  Assert that:
 *   1. The HTTP status equals the upstream 4xx, NOT a gateway-owned 500.
 *   2. The response body is the upstream provider's JSON error object (an
 *      object), not a gateway-invented string like "Internal server error".
 *
 * Does NOT require valid API keys — all cases run unconditionally in any
 * environment.
 *
 * Run with: `npm run e2e:errors`
 */
import type { AddressInfo } from 'net';

// Override any real keys already loaded by dotenv/config (pre-required via -r)
// so every provider call is guaranteed to fail at the provider's auth check.
process.env.OPENAI_API_KEY     = 'sk-intentionally-invalid-key-for-error-testing';
process.env.GEMINI_API_KEY     = 'intentionally-invalid-gemini-key';
process.env.OPENROUTER_API_KEY = 'intentionally-invalid-openrouter-key';
process.env.AUTH_MODE   = 'none';
process.env.QUOTA_STORE = 'memory';

// Import AFTER env vars are set so provider singleton clients pick up bad keys.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const app = require('../src/app').default;

// ─── Types ───────────────────────────────────────────────────────────────────

type Outcome = 'pass' | 'fail';
interface TestResult { name: string; outcome: Outcome; detail: string; }

interface ErrorCase {
  name: string;
  model: string;
  stream: boolean;
}

// ─── Test matrix ─────────────────────────────────────────────────────────────

const cases: ErrorCase[] = [
  { name: 'OpenAI · bad key · non-streaming',  model: 'gpt-4o-mini',      stream: false },
  { name: 'OpenAI · bad key · streaming',      model: 'gpt-4o-mini',      stream: true  },
  { name: 'Gemini · bad key · non-streaming',  model: 'gemini-2.5-flash', stream: false },
  { name: 'OpenRouter · bad key',              model: 'llama-3.3-70b',    stream: false },
];

// ─── Runner ──────────────────────────────────────────────────────────────────

const runCase = async (baseUrl: string, c: ErrorCase): Promise<TestResult> => {
  const response = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: c.model,
      messages: [{ role: 'user', content: 'hi' }],
      stream: c.stream,
    }),
  });

  // ── Assertion 1: status must be 4xx (upstream auth error), NOT 5xx ─────────
  // A gateway-invented error would be 500.  A proxied upstream error is 4xx.
  if (response.status < 400 || response.status >= 500) {
    return {
      name: c.name,
      outcome: 'fail',
      detail: `expected 4xx upstream error, got HTTP ${response.status}`,
    };
  }

  // ── Assertion 2: body must be the upstream JSON error object ───────────────
  // Gateway-invented messages: { error: "some string" }
  // Upstream provider bodies:  { error: { message: "...", type: "..." } }
  const text = await response.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    return {
      name: c.name,
      outcome: 'fail',
      detail: `response body is not JSON: ${text.slice(0, 120)}`,
    };
  }

  const errorVal = body?.error;
  if (errorVal === undefined || typeof errorVal !== 'object' || errorVal === null) {
    return {
      name: c.name,
      outcome: 'fail',
      detail: `body.error should be an upstream error object, got: ${JSON.stringify(body).slice(0, 150)}`,
    };
  }

  return {
    name: c.name,
    outcome: 'pass',
    detail: `HTTP ${response.status} · ${JSON.stringify(errorVal).slice(0, 100)}`,
  };
};

// ─── Entry point ─────────────────────────────────────────────────────────────

const main = async () => {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`error-forwarding e2e: gateway on ${baseUrl}\n`);

  const results: TestResult[] = [];

  for (const c of cases) {
    process.stdout.write(`• ${c.name} ... `);
    let result: TestResult;
    try {
      result = await runCase(baseUrl, c);
    } catch (error: any) {
      result = { name: c.name, outcome: 'fail', detail: `harness error: ${error?.message ?? String(error)}` };
    }
    results.push(result);
    console.log(`${result.outcome.toUpperCase()} (${result.detail})`);
  }

  server.close();

  const failures = results.filter((r) => r.outcome === 'fail');
  console.log(`\nSummary: ${results.length - failures.length} passed, ${failures.length} failed`);
  process.exit(failures.length > 0 ? 1 : 0);
};

main().catch((err) => {
  console.error('harness error:', err);
  process.exit(1);
});
