/**
 * Client-side end-to-end verification harness.
 *
 * Boots a local dev deployment of the gateway (AUTH_MODE=none, QUOTA_STORE=memory),
 * runs a short prompt suite spanning multiple models and all three engines
 * (including a proxy model and a streaming request), and prints a pass/fail/skip
 * summary. LLM tokens come from the environment (.env); prompts whose token is
 * missing are skipped. Exits non-zero on any failure.
 *
 * Run with: `npm run e2e`
 */
import type { AddressInfo } from 'net';

// Force local dev mode regardless of the ambient .env.
process.env.AUTH_MODE = 'none';
process.env.QUOTA_STORE = 'memory';

// Snapshot which provider keys are really present BEFORE importing the app —
// the provider client modules default missing keys to a placeholder on import.
const availableKeys: Record<string, boolean> = {
  OPENAI_API_KEY: Boolean(process.env.OPENAI_API_KEY),
  GEMINI_API_KEY: Boolean(process.env.GEMINI_API_KEY),
  OPENROUTER_API_KEY: Boolean(process.env.OPENROUTER_API_KEY),
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const app = require('../src/app').default;
import { E2ePrompt, prompts } from './prompts';

type Outcome = 'pass' | 'fail' | 'skip';

interface Result {
  name: string;
  outcome: Outcome;
  detail?: string;
}

const extractContent = (raw: string): string => {
  const trimmed = raw.trim();
  // Non-streaming responses are a single ChatCompletion JSON object.
  try {
    const parsed = JSON.parse(trimmed);
    return parsed?.choices?.[0]?.message?.content ?? '';
  } catch {
    // Streaming responses are concatenated deltas followed by a final JSON blob.
    // Any non-empty streamed text counts as success.
    return trimmed;
  }
};

const runPrompt = async (baseUrl: string, prompt: E2ePrompt): Promise<Result> => {
  if (!availableKeys[prompt.requiredKey]) {
    return { name: prompt.name, outcome: 'skip', detail: `${prompt.requiredKey} not set` };
  }

  try {
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: prompt.model, messages: prompt.messages, stream: prompt.stream }),
    });

    const text = await response.text();
    if (response.status !== 200) {
      return { name: prompt.name, outcome: 'fail', detail: `HTTP ${response.status}: ${text.slice(0, 200)}` };
    }

    const content = extractContent(text);
    if (!content || content.trim().length === 0) {
      return { name: prompt.name, outcome: 'fail', detail: 'empty assistant message' };
    }

    return { name: prompt.name, outcome: 'pass', detail: content.replace(/\s+/g, ' ').slice(0, 60) };
  } catch (error: any) {
    return { name: prompt.name, outcome: 'fail', detail: error?.message ?? String(error) };
  }
};

const main = async () => {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  console.log(`e2e: gateway listening on ${baseUrl} (AUTH_MODE=none, QUOTA_STORE=memory)\n`);

  const results: Result[] = [];
  for (const prompt of prompts) {
    process.stdout.write(`• ${prompt.name} ... `);
    const result = await runPrompt(baseUrl, prompt);
    results.push(result);
    const label = result.outcome.toUpperCase();
    console.log(`${label}${result.detail ? ` (${result.detail})` : ''}`);
  }

  server.close();

  const counts = results.reduce(
    (acc, r) => ({ ...acc, [r.outcome]: (acc as any)[r.outcome] + 1 }),
    { pass: 0, fail: 0, skip: 0 }
  );

  console.log(`\nSummary: ${counts.pass} passed, ${counts.fail} failed, ${counts.skip} skipped`);
  process.exit(counts.fail > 0 ? 1 : 0);
};

main().catch((error) => {
  console.error('e2e harness error:', error);
  process.exit(1);
});
