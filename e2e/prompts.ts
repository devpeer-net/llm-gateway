/**
 * Short, curated end-to-end prompt suite exercising multiple models across all
 * three engines (OpenAI, Gemini, OpenRouter), plus at least one proxy model and
 * one streaming request.
 *
 * `requiredKey` gates each prompt: if the env var is missing the prompt is
 * skipped (with a clear log line) rather than failing the run.
 */
export interface E2ePrompt {
  name: string;
  model: string;
  /** Env var that must be present for this prompt to run. */
  requiredKey: 'OPENAI_API_KEY' | 'GEMINI_API_KEY' | 'OPENROUTER_API_KEY';
  stream: boolean;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
}

export const prompts: E2ePrompt[] = [
  {
    name: 'OpenAI · gpt-4o-mini (non-streaming)',
    model: 'gpt-4o-mini',
    requiredKey: 'OPENAI_API_KEY',
    stream: false,
    messages: [{ role: 'user', content: 'Reply with exactly the word: pong' }],
  },
  {
    name: 'OpenAI · gpt-4o-mini (streaming)',
    model: 'gpt-4o-mini',
    requiredKey: 'OPENAI_API_KEY',
    stream: true,
    messages: [{ role: 'user', content: 'Count from 1 to 5, separated by spaces.' }],
  },
  {
    name: 'Gemini · gemini-2.5-flash (non-streaming)',
    model: 'gemini-2.5-flash',
    requiredKey: 'GEMINI_API_KEY',
    stream: false,
    messages: [{ role: 'user', content: 'Reply with exactly the word: pong' }],
  },
  {
    name: 'OpenRouter · llama-3.3-70b (non-streaming)',
    model: 'llama-3.3-70b',
    requiredKey: 'OPENROUTER_API_KEY',
    stream: false,
    messages: [{ role: 'user', content: 'Reply with exactly the word: pong' }],
  },
  {
    name: 'Proxy · gateway-fast (round-robin + failover)',
    // The proxy's primary underlying model is a Gemini model.
    model: 'gateway-fast',
    requiredKey: 'GEMINI_API_KEY',
    stream: false,
    messages: [{ role: 'user', content: 'Reply with exactly the word: pong' }],
  },
];
