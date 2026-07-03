import { ChatRequestBody, ApiUsage } from '../types';
import {
  getOpenRouterModelId,
  isGeminiModel,
  isOpenAIModel,
  isOpenRouterModel,
} from '../llm/model-catalog';
import { generateOpenAI } from '../llm/openai-chat-service';
import openAI from '../providers/openai-client';
import openRouterAPI from '../providers/openrouter-client';
import geminiAI from '../providers/gemini-client';
import { ChatCompletionChunk, ChatCompletionCreateParamsBase } from 'openai/resources/chat/completions';
import { ChatCompletion } from 'openai/resources';
import {
  isProxyModel,
  advanceProxyModel,
  getProxyModelList,
  getOpenRouterFallback,
} from './proxy-model-resolver';
import OpenAI from 'openai';

export const mapToOpenRouterModel = (model: string): string => getOpenRouterModelId(model);

export const generate = async (
  body: ChatRequestBody,
  apiUsage: ApiUsage,
  generateCallback?: (chunk: ChatCompletionChunk) => boolean
): Promise<ChatCompletion> => {
  if (isProxyModel(body.model)) {
    return generateWithProxyFallback(body, apiUsage, generateCallback);
  }
  return generateDirect(body.model, body, apiUsage, generateCallback);
};

/**
 * Try each model in the proxy's round-robin list.
 * On 429 (rate limit), advance to the next model and retry.
 * Uses a local snapshot of the model list so concurrent requests advancing the
 * global index can't cause this request to retry the same model.
 * After all direct models are exhausted, falls back to the configured
 * OpenRouter model (same model, different provider).
 */
const generateWithProxyFallback = async (
  body: ChatRequestBody,
  apiUsage: ApiUsage,
  generateCallback?: (chunk: ChatCompletionChunk) => boolean
): Promise<ChatCompletion> => {
  const proxyId = body.model;
  // Snapshot: ordered starting from the current round-robin position.
  const modelsToTry = getProxyModelList(proxyId);
  let lastError: unknown;

  for (let i = 0; i < modelsToTry.length; i++) {
    const model = modelsToTry[i];
    console.log(`[proxy-model] Attempting ${model} for ${proxyId} (attempt ${i + 1}/${modelsToTry.length})`);

    try {
      const result = await generateDirect(model, body, apiUsage, generateCallback);
      // Update body.model so the downstream quota handler bills the actual model.
      body.model = model;
      return result;
    } catch (error) {
      lastError = error;
      if (isRateLimitError(error)) {
        console.warn(`[proxy-model] 429 from ${model}, advancing round-robin`);
        advanceProxyModel(proxyId);
        continue;
      }
      throw error;
    }
  }

  // All direct models exhausted — try OpenRouter fallback (same model, different provider).
  const orFallback = getOpenRouterFallback(proxyId);
  if (orFallback) {
    console.warn(`[proxy-model] All models exhausted for ${proxyId}, trying OpenRouter fallback: ${orFallback}`);
    const result = await generateViaOpenRouter(orFallback, body, apiUsage, generateCallback);
    // Bill against the catalog model name (e.g. 'gemini-2.5-flash') rather than
    // the raw OpenRouter ID (e.g. 'google/gemini-2.5-flash') so downstream quota
    // handlers can look it up in the model catalog.
    const slashIdx = orFallback.indexOf('/');
    body.model = slashIdx >= 0 ? orFallback.slice(slashIdx + 1) : orFallback;
    return result;
  }

  throw lastError;
};

/** Send a request directly to OpenRouter using a raw OpenRouter model ID. */
const generateViaOpenRouter = async (
  openRouterModelId: string,
  body: ChatRequestBody,
  _apiUsage: ApiUsage,
  generateCallback?: (chunk: ChatCompletionChunk) => boolean
): Promise<ChatCompletion> => {
  const completionParams: ChatCompletionCreateParamsBase = {
    model: openRouterModelId,
    messages: body.messages,
    tools: body.tools,
    parallel_tool_calls: body.parallel_tool_calls,
    user: body.user,
  };
  return await generateOpenAI(openRouterAPI, completionParams, true, generateCallback);
};

/** Check whether an error is a 429 rate-limit response from the upstream API. */
const isRateLimitError = (error: unknown): boolean => {
  if (error instanceof OpenAI.RateLimitError) return true;
  if (error instanceof OpenAI.APIError && error.status === 429) return true;
  return false;
};

const generateDirect = async (
  model: string,
  body: ChatRequestBody,
  apiUsage: ApiUsage,
  generateCallback?: (chunk: ChatCompletionChunk) => boolean
): Promise<ChatCompletion> => {
  let completionParams: ChatCompletionCreateParamsBase = {
    model,
    messages: body.messages,
    tools: body.tools,
    parallel_tool_calls: body.parallel_tool_calls,
    user: body.user,
    ...(body.safety_identifier && { safety_identifier: body.safety_identifier }),
  };
  if (isGeminiModel(model)) {
    // Gemini (OpenAI-compat) does not support parallel_tool_calls, user, or custom fields.
    const { parallel_tool_calls, user, safety_identifier, ...geminiParams } = completionParams as any;
    return await generateOpenAI(geminiAI, geminiParams, false, generateCallback);
  } else if (isOpenAIModel(model)) {
    return await generateOpenAI(openAI, completionParams, false, generateCallback);
  } else if (isOpenRouterModel(model)) {
    const openRouterModel = mapToOpenRouterModel(model);
    completionParams.model = openRouterModel;
    return await generateOpenAI(openRouterAPI, completionParams, true, generateCallback);
  } else {
    throw new Error(`Unknown model: ${model}`);
  }
};
