import { CompletionUsage } from 'openai/resources';
import { calculateCredits, estimateCredits } from './credits-service';
import { kChatCompletionsPath } from '../paths';
import { costs } from '../llm/model-catalog';
import { LLMModel } from '../types';

describe('calculateCredits', () => {
  const usageMetadata: CompletionUsage = {
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
  };

  it('should calculate credits for supported models', () => {
    costs.forEach((cost) => {
      const model = cost.model as LLMModel;
      const expectedCredits =
        usageMetadata.prompt_tokens * cost.inputTokenValue + usageMetadata.completion_tokens * cost.outputTokenValue;
      expect(calculateCredits(model, usageMetadata)).toBe(expectedCredits);
    });
  });

  it('should throw for unsupported model', () => {
    expect(() => calculateCredits('unsupported-model' as LLMModel, usageMetadata)).toThrow();
  });

  it('should throw error for null model', () => {
    expect(() => calculateCredits(null as any, usageMetadata)).toThrow('Model is required');
  });

  it('should throw error for undefined model', () => {
    expect(() => calculateCredits(undefined as any, usageMetadata)).toThrow('Model is required');
  });

  it('should throw error for null usage metadata', () => {
    expect(() => calculateCredits('gpt-4o-mini' as LLMModel, null as any)).toThrow('Usage metadata is required');
  });

  it('should throw error for missing token counts', () => {
    const invalidUsage = {} as CompletionUsage;
    expect(() => calculateCredits('gpt-4o-mini' as LLMModel, invalidUsage)).toThrow(
      'Invalid usage metadata: missing token counts'
    );
  });

  it('should throw error for negative token counts', () => {
    const invalidUsage = { prompt_tokens: -5, completion_tokens: 10, total_tokens: 5 } as CompletionUsage;
    expect(() => calculateCredits('gpt-4o-mini' as LLMModel, invalidUsage)).toThrow(
      'Invalid usage metadata: negative token counts'
    );
  });

  it('should handle alternative token field names (input_tokens/output_tokens)', () => {
    const alternativeUsage = { input_tokens: 10, output_tokens: 5 } as any;
    const model = 'gpt-4o-mini' as LLMModel;
    const cost = costs.find((c) => c.model === model)!;
    const expectedCredits = 10 * cost.inputTokenValue + 5 * cost.outputTokenValue;
    expect(calculateCredits(model, alternativeUsage)).toBe(expectedCredits);
  });
});

describe('estimateCredits', () => {
  it('estimates credits for a chat completion request', () => {
    const req = {
      path: kChatCompletionsPath,
      body: { model: 'gpt-4o-mini', messages: [{ content: 'Hello there, general.' }] },
    } as any;
    expect(estimateCredits(req)).toBeGreaterThanOrEqual(0);
  });

  it('returns 0 for an unrelated path', () => {
    const req = { path: '/something-else', body: {} } as any;
    expect(estimateCredits(req)).toBe(0);
  });
});
