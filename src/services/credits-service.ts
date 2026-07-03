import { AIModel, ChatRequestBody, ModelCost } from '../types';
import { costs } from '../llm/model-catalog';
import { CompletionUsage, Responses } from 'openai/resources';
import { Request } from 'express';
import { kChatCompletionsPath } from '../paths';
import { isProxyModel, resolveProxyModel } from './proxy-model-resolver';

export const calculateCredits = (
  model: AIModel,
  usageMetadata: CompletionUsage | Responses.ResponseUsage
): number => {
  if (!model) {
    throw new Error('Model is required');
  }
  if (!usageMetadata) {
    throw new Error('Usage metadata is required');
  }

  // Handle different API response formats (OpenAI vs other providers).
  const metadata = usageMetadata as any;
  const promptTokens = metadata.prompt_tokens ?? metadata.input_tokens;
  const completionTokens = metadata.completion_tokens ?? metadata.output_tokens;

  if (promptTokens == null || completionTokens == null) {
    throw new Error('Invalid usage metadata: missing token counts');
  }

  if (promptTokens < 0 || completionTokens < 0) {
    throw new Error('Invalid usage metadata: negative token counts');
  }

  const cost: ModelCost | undefined = costs.find((c: ModelCost) => c.model === model);
  if (!cost) {
    throw new Error(`Cost not found for model: ${model}`);
  }

  return promptTokens * cost.inputTokenValue + completionTokens * cost.outputTokenValue;
};

export const estimateCredits = (req: Request): number => {
  const path = req.path;
  const body = req.body;
  try {
    if (path.includes(kChatCompletionsPath)) {
      const chatBody = body as ChatRequestBody;
      // Proxy model IDs are not in the cost table; resolve to the primary
      // underlying real model so cost estimation doesn't throw.
      const effectiveModel = isProxyModel(chatBody.model)
        ? (resolveProxyModel(chatBody.model) ?? chatBody.model)
        : chatBody.model;
      const estimatedTokens =
        chatBody.messages?.map((msg) => (msg.content ? (msg.content as string).length : 0)).reduce((acc, cur) => acc + cur, 0) / 4 || 0;
      const usageMetadata: CompletionUsage = {
        prompt_tokens: estimatedTokens,
        completion_tokens: 0,
        total_tokens: estimatedTokens,
      };
      return calculateCredits(effectiveModel as AIModel, usageMetadata);
    }
    console.warn(`No credits calculation for path: ${path}`);
    return 0;
  } catch (e: any) {
    throw new Error(`Error estimating credits: ${e.toString()}`);
  }
};
