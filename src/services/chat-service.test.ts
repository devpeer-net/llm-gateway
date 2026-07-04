import { generate, mapToOpenRouterModel } from './chat-service';
import { __resetProxyRoundRobin } from './proxy-model-resolver';
import { ChatCompletionMessageParam } from 'openai/resources';
import OpenAI from 'openai';
import { generateOpenAI } from '../llm/openai-chat-service';

// Mock the low-level generation helper and the provider clients.
jest.mock('../llm/openai-chat-service', () => ({
  generateOpenAI: jest.fn(),
}));
jest.mock('../providers/openai-client');
jest.mock('../providers/gemini-client');
jest.mock('../providers/openrouter-client');

describe('mapToOpenRouterModel', () => {
  it('maps catalog OpenRouter models to their raw OpenRouter ids', () => {
    expect(mapToOpenRouterModel('llama-3.3-70b')).toBe('meta-llama/llama-3.3-70b-instruct');
    expect(mapToOpenRouterModel('deepseek-chat')).toBe('deepseek/deepseek-chat');
  });

  it('returns the original model if not mapped', () => {
    expect(mapToOpenRouterModel('unmapped-model')).toBe('unmapped-model');
  });
});

const fakeHeaders = { get: () => null } as any;
const make429 = () => new OpenAI.RateLimitError(429, null as any, 'Too many requests', fakeHeaders);

const mockCompletion = {
  id: 'chatcmpl-test',
  created: 1234567890,
  model: 'google/gemini-2.5-flash',
  object: 'chat.completion' as const,
  choices: [
    {
      finish_reason: 'stop' as const,
      index: 0,
      logprobs: null,
      message: { content: 'Hello!', role: 'assistant' as const, refusal: null, tool_calls: undefined },
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

describe('proxy model OpenRouter fallback', () => {
  const mockMessages: ChatCompletionMessageParam[] = [{ role: 'user', content: 'hello' }];
  const mockApiUsage = {} as any;
  const mockGenerate = jest.mocked(generateOpenAI);

  beforeEach(() => {
    __resetProxyRoundRobin();
    mockGenerate.mockReset();
  });

  describe('gateway-chat (single direct model)', () => {
    it('falls back to OpenRouter after the direct model returns 429', async () => {
      mockGenerate
        .mockRejectedValueOnce(make429()) // direct: gpt-4o-mini → 429
        .mockResolvedValueOnce(mockCompletion as any); // fallback: OpenRouter → success

      const body = { model: 'gateway-chat', messages: mockMessages } as any;
      const result = await generate(body, mockApiUsage);

      expect(result).toEqual(mockCompletion);
      // Billed as the catalog model name derived from the OpenRouter fallback id.
      expect(body.model).toBe('gpt-4o-mini');
      expect(mockGenerate).toHaveBeenCalledTimes(2);
      const fallbackParams = mockGenerate.mock.calls[1][1];
      expect((fallbackParams as any).model).toBe('openai/gpt-4o-mini');
      expect(mockGenerate.mock.calls[1][2]).toBe(true); // isOpenrouter flag
    });

    it('does not fall back on non-429 errors', async () => {
      mockGenerate.mockRejectedValueOnce(new Error('Internal server error'));

      const body = { model: 'gateway-chat', messages: mockMessages } as any;
      await expect(generate(body, mockApiUsage)).rejects.toThrow('Internal server error');
      expect(mockGenerate).toHaveBeenCalledTimes(1);
    });
  });

  describe('gateway-fast (three direct models)', () => {
    it('succeeds on an intermediate direct model without invoking OpenRouter', async () => {
      mockGenerate
        .mockRejectedValueOnce(make429()) // first direct model → 429
        .mockResolvedValueOnce(mockCompletion as any); // second direct model → success

      const body = { model: 'gateway-fast', messages: mockMessages } as any;
      const result = await generate(body, mockApiUsage);

      expect(result).toEqual(mockCompletion);
      expect(mockGenerate).toHaveBeenCalledTimes(2);
      // Billed against a direct model, not the OpenRouter fallback id.
      expect(body.model).not.toContain('/');
    });

    it('falls back to OpenRouter only after all 3 direct models return 429', async () => {
      mockGenerate
        .mockRejectedValueOnce(make429())
        .mockRejectedValueOnce(make429())
        .mockRejectedValueOnce(make429())
        .mockResolvedValueOnce(mockCompletion as any); // OpenRouter fallback → success

      const body = { model: 'gateway-fast', messages: mockMessages } as any;
      const result = await generate(body, mockApiUsage);

      expect(result).toEqual(mockCompletion);
      expect(body.model).toBe('gemini-2.5-flash'); // catalog name, not raw OpenRouter id
      expect(mockGenerate).toHaveBeenCalledTimes(4);
      const fallbackParams = mockGenerate.mock.calls[3][1];
      expect((fallbackParams as any).model).toBe('google/gemini-2.5-flash');
      expect(mockGenerate.mock.calls[3][2]).toBe(true);
    });

    it('throws the last 429 error when even the OpenRouter fallback fails', async () => {
      mockGenerate
        .mockRejectedValueOnce(make429())
        .mockRejectedValueOnce(make429())
        .mockRejectedValueOnce(make429())
        .mockRejectedValueOnce(make429()); // OpenRouter fallback

      const body = { model: 'gateway-fast', messages: mockMessages } as any;
      await expect(generate(body, mockApiUsage)).rejects.toBeInstanceOf(OpenAI.RateLimitError);
      expect(mockGenerate).toHaveBeenCalledTimes(4);
    });
  });
});

// ─── Provider-level fallback (5xx / auth errors on direct model requests) ───

describe('provider-level fallback', () => {
  const mockMessages: ChatCompletionMessageParam[] = [{ role: 'user', content: 'hello' }];
  const mockApiUsage = {} as any;
  const mockGenerate = jest.mocked(generateOpenAI);

  const fakeHeaders = { get: () => null } as any;
  const make5xx = () =>
    new OpenAI.InternalServerError(500, null as any, 'Internal Server Error', fakeHeaders);
  const make401 = () =>
    new OpenAI.AuthenticationError(401, null as any, 'Unauthorized', fakeHeaders);

  beforeEach(() => {
    mockGenerate.mockReset();
  });

  // gemini-3.1-flash-lite has providers: [gemini, openrouter].
  // In tests all providers report isConfigured=false (jest.mock replaces modules),
  // so the fallback logic tries all providers in catalog order.

  it('falls back to openrouter when gemini returns a 5xx error', async () => {
    mockGenerate
      .mockRejectedValueOnce(make5xx()) // gemini → 500
      .mockResolvedValueOnce(mockCompletion as any); // openrouter → success

    const body = { model: 'gemini-3.1-flash-lite', messages: mockMessages } as any;
    const result = await generate(body, mockApiUsage);

    expect(result).toEqual(mockCompletion);
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    // Second call must target openrouter (isOpenrouter flag = true).
    expect(mockGenerate.mock.calls[1][2]).toBe(true);
    // And must use the catalog openRouterModel ID.
    expect((mockGenerate.mock.calls[1][1] as any).model).toBe('google/gemini-3.1-flash-lite');
  });

  it('falls back to openrouter when gemini returns a 401 (bad/revoked key)', async () => {
    mockGenerate
      .mockRejectedValueOnce(make401()) // gemini → 401
      .mockResolvedValueOnce(mockCompletion as any); // openrouter → success

    const body = { model: 'gemini-3.1-flash-lite', messages: mockMessages } as any;
    const result = await generate(body, mockApiUsage);

    expect(result).toEqual(mockCompletion);
    expect(mockGenerate).toHaveBeenCalledTimes(2);
    expect(mockGenerate.mock.calls[1][2]).toBe(true); // openrouter path
  });

  it('does NOT fall back on a 4xx client error (e.g. bad request)', async () => {
    const bad400 = new OpenAI.BadRequestError(400, null as any, 'Bad Request', fakeHeaders);
    mockGenerate.mockRejectedValueOnce(bad400);

    const body = { model: 'gemini-3.1-flash-lite', messages: mockMessages } as any;
    await expect(generate(body, mockApiUsage)).rejects.toBeInstanceOf(OpenAI.BadRequestError);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
  });

  it('throws the last error when all providers fail with 5xx', async () => {
    mockGenerate
      .mockRejectedValueOnce(make5xx()) // gemini
      .mockRejectedValueOnce(make5xx()); // openrouter

    const body = { model: 'gemini-3.1-flash-lite', messages: mockMessages } as any;
    await expect(generate(body, mockApiUsage)).rejects.toBeInstanceOf(OpenAI.InternalServerError);
    expect(mockGenerate).toHaveBeenCalledTimes(2);
  });

  it('routes a single-provider model directly without attempting fallback', async () => {
    // gpt-4o has providers: [{ name: 'openai' }].
    mockGenerate.mockResolvedValueOnce(mockCompletion as any);

    const body = { model: 'gpt-4o', messages: mockMessages } as any;
    const result = await generate(body, mockApiUsage);

    expect(result).toEqual(mockCompletion);
    expect(mockGenerate).toHaveBeenCalledTimes(1);
    expect(mockGenerate.mock.calls[0][2]).toBe(false); // not openrouter
  });
});
