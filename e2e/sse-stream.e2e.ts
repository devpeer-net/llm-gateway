/**
 * SSE streaming verification harness.
 *
 * Boots a local dev deployment of the gateway (AUTH_MODE=none, QUOTA_STORE=memory)
 * and drives the /v1/chat/completions streaming endpoint with the *official
 * OpenAI SDK* — i.e. a standard SSE client. This proves the endpoint emits real
 * `data: {chat.completion.chunk}\n\n` frames terminated by `data: [DONE]`,
 * rather than raw text or a single JSON blob.
 *
 * Assertions:
 *   1. The SDK parses the response as a stream (multiple chunks arrive).
 *   2. Chunk objects have object === 'chat.completion.chunk'.
 *   3. Content accumulated from `choices[0].delta.content` is non-empty.
 *   4. The stream terminates cleanly (the async iterator completes on [DONE]).
 *
 * Skips gracefully if no provider key is available. Exits non-zero on failure.
 *
 * Run with: `npm run e2e:sse`
 */
import type { AddressInfo } from 'net';
import OpenAI from 'openai';

// Force local dev mode regardless of the ambient .env.
process.env.AUTH_MODE = 'none';
process.env.QUOTA_STORE = 'memory';

// Pick the first provider whose key is present. Snapshot BEFORE importing the
// app, since provider client modules default missing keys to a placeholder.
const candidates: Array<{ envVar: string; model: string }> = [
  { envVar: 'OPENAI_API_KEY', model: 'gpt-4o-mini' },
  { envVar: 'GEMINI_API_KEY', model: 'gemini-2.5-flash' },
  { envVar: 'OPENROUTER_API_KEY', model: 'llama-3.3-70b' },
];
const selected = candidates.find((c) => Boolean(process.env[c.envVar]));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const app = require('../src/app').default;

const main = async () => {
  if (!selected) {
    console.log('sse-e2e: SKIP — no provider key set (OPENAI_API_KEY / GEMINI_API_KEY / OPENROUTER_API_KEY)');
    process.exit(0);
  }

  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}/v1`;
  console.log(`sse-e2e: gateway listening on ${baseUrl} (model=${selected.model})\n`);

  const client = new OpenAI({ baseURL: baseUrl, apiKey: 'no-auth-dev-key' });

  let chunkCount = 0;
  let contentChunkCount = 0;
  let badObjectType: string | undefined;
  let accumulated = '';

  try {
    const stream = await client.chat.completions.create({
      model: selected.model,
      stream: true,
      messages: [{ role: 'user', content: 'Count from 1 to 5, separated by spaces.' }],
    });

    for await (const chunk of stream) {
      chunkCount++;
      if (chunk.object !== 'chat.completion.chunk') {
        badObjectType = chunk.object;
      }
      const delta = chunk.choices?.[0]?.delta?.content ?? '';
      if (delta) {
        contentChunkCount++;
        accumulated += delta;
      }
    }
  } catch (error: any) {
    console.error(`sse-e2e: FAIL — SDK stream error: ${error?.message ?? String(error)}`);
    server.close();
    process.exit(1);
  }

  server.close();

  const failures: string[] = [];
  if (chunkCount < 2) {
    failures.push(`expected multiple SSE chunks, got ${chunkCount} (endpoint may be sending a single blob)`);
  }
  if (badObjectType) {
    failures.push(`chunk had object='${badObjectType}', expected 'chat.completion.chunk'`);
  }
  if (accumulated.trim().length === 0) {
    failures.push('accumulated streamed content was empty');
  }

  console.log(`sse-e2e: received ${chunkCount} chunks (${contentChunkCount} with content)`);
  console.log(`sse-e2e: accumulated content: ${JSON.stringify(accumulated.replace(/\s+/g, ' ').slice(0, 80))}`);

  if (failures.length > 0) {
    console.error('\nsse-e2e: FAIL');
    for (const f of failures) console.error(`  • ${f}`);
    process.exit(1);
  }

  console.log('\nsse-e2e: PASS — official OpenAI SDK parsed real SSE chunks end-to-end');
  process.exit(0);
};

main().catch((error) => {
  console.error('sse-e2e harness error:', error);
  process.exit(1);
});
