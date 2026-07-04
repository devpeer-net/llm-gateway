import { ChatRequestBody, ApiUsage } from '../types';
import {
  getOpenRouterModelId,
  getModelProviders,
  ModelProviderEntry,
} from '../llm/model-catalog';
import { generateOpenAI } from '../llm/openai-chat-service';
import openAI, { isConfigured as isOpenAIConfigured } from '../providers/openai-client';
import openRouterAPI, { isConfigured as isOpenRouterConfigured } from '../providers/openrouter-client';
import geminiAI, { isConfigured as isGeminiConfigured } from '../providers/gemini-client';
import { ChatCompletionChunk, ChatCompletionCreateParamsBase } from 'openai/resources/chat/completions';
import { ChatCompletion } from 'openai/resources';
import {
  isProxyModel,
  advanceProxyModel,
  getProxyModelList,
  getOpenRouterFallback,
} from './proxy-model-resolver';
import OpenAI from 'openai';
import { ModelEngine } from '../types';

export const mapToOpenRouterModel = (model: string): string => getOpenRouterModelId(model);

export const generate = async (
  body: ChatRequestBody,
  apiUsage: ApiUsage,
  generateCallback?: (chunk: ChatCompletionChunk) => boolean
): Promise<ChatCompletion> => {
  if (isProxyModel(body.model)) {
    return generateWithProxyFallback(body, apiUsage, generateCallback);
  }
  return generateWithProviderFallback(body.model, body, apiUsage, generateCallback);
};

/** Returns true if the named engine has a real API key configured at startup. */
const isProviderAvailable = (engine: ModelEngine): boolean => {
  if (engine === 'gemini') return isGeminiConfigured;
  if (engine === 'openai') return isOpenAIConfigured;
  if (engine === 'openrouter') return isOpenRouterConfigured;
  return false;
};

/**
 * Try the model's providers in order (primary first, then fallbacks).
 * Providers without a configured API key are skipped upfront.
 * A server error (5xx) or auth error (401) from a provider triggers fallback
 * to the next one. Any other error (4xx, network error, etc.) is re-thrown
 * immediately without trying further providers.
 */
const generateWithProviderFallback = async (
  model: string,
  body: ChatRequestBody,
  apiUsage: ApiUsage,
  generateCallback?: (chunk: ChatCompletionChunk) => boolean
): Promise<ChatCompletion> => {
  const allProviders = getModelProviders(model);
  // Skip providers with no key; if all are unconfigured attempt all anyway so
  // the first one surfaces a meaningful auth error rather than a silent skip.
  const configured = allProviders.filter(p => isProviderAvailable(p.engine));
  const candidates = configured.length > 0 ? configured : allProviders;

  let lastError: unknown;
  for (let i = 0; i < candidates.length; i++) {
    const provider = candidates[i];
    try {
      return await generateViaProvider(model, provider, body, apiUsage, generateCallback);
    } catch (error) {
      lastError = error;
      if (isServerError(error) || isAuthError(error)) {
        if (i < candidates.length - 1) {
          console.warn(
            `[provider-fallback] ${provider.engine} failed for ${model} (status ${(error as any)?.status ?? 'unknown'}), trying next provider`
          );
        }
        continue;
      }
      throw error;
    }
  }
  throw lastError;
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
    // Use the primary configured provider for each proxy model.
    const providers = getModelProviders(model);
    const provider = providers.find(p => isProviderAvailable(p.engine)) ?? providers[0];

    try {
      const result = await generateViaProvider(model, provider, body, apiUsage, generateCallback);
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

/** Dispatch a single request to the specified provider. */
const generateViaProvider = async (
  model: string,
  provider: ModelProviderEntry,
  body: ChatRequestBody,
  _apiUsage: ApiUsage,
  generateCallback?: (chunk: ChatCompletionChunk) => boolean
): Promise<ChatCompletion> => {
  const completionParams: ChatCompletionCreateParamsBase = {
    model,
    messages: body.messages,
    tools: body.tools,
    parallel_tool_calls: body.parallel_tool_calls,
    user: body.user,
    ...(body.safety_identifier && { safety_identifier: body.safety_identifier }),
  };

  switch (provider.engine) {
    case 'gemini': {
      // Gemini (OpenAI-compat) does not support parallel_tool_calls, user, or custom fields.
      const { parallel_tool_calls, user, safety_identifier, ...geminiParams } = completionParams as any;
      return await generateOpenAI(geminiAI, geminiParams, false, generateCallback);
    }
    case 'openai':
      return await generateOpenAI(openAI, completionParams, false, generateCallback);
    case 'openrouter': {
      const orModel = provider.openRouterModel ?? mapToOpenRouterModel(model);
      return await generateOpenAI(openRouterAPI, { ...completionParams, model: orModel }, true, generateCallback);
    }
    default:
      throw new Error(`Unknown engine: ${(provider as any).engine}`);
  }
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

/** Check whether an error is a server-side (5xx) error from the upstream API. */
const isServerError = (error: unknown): boolean =>
  error instanceof OpenAI.APIError && error.status >= 500;

/** Check whether an error is an authentication failure (401) from the upstream API. */
const isAuthError = (error: unknown): boolean =>
  error instanceof OpenAI.APIError && error.status === 401;
