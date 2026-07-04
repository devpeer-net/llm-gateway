import { LLMModel, ModelCost, ModelEngine, ModelVendor } from '../types';
import costsData from './costs/costs.json';

/** A single provider that can serve a model, in priority order. */
export interface ModelProviderEntry {
  name: ModelEngine;
  /** Provider-specific model identifier (e.g. 'google/gemini-3.1-flash-lite' for OpenRouter). */
  providerModelId?: string;
}

export interface ModelCatalogEntry extends ModelCost {
  displayName?: string;
  vendor?: ModelVendor;
  legacy?: boolean;
  /**
   * Ordered list of providers to try for this model.
   * The first entry is the primary provider; subsequent entries are fallbacks
   * used when the primary has no API key configured or returns a server error (5xx).
   */
  providers: ModelProviderEntry[];
}

export interface NormalizedModelCatalogEntry extends ModelCatalogEntry {
  displayName: string;
  vendor: ModelVendor;
}

/** Raw cost coefficients, exported for credit calculations. */
export const costs = costsData as ModelCost[];

const kModelFamilyTitle = (value: string): string =>
  value.replace(/-/g, ' ').replace(/\b([a-z])/g, (match) => match.toUpperCase());

const formatModelDisplayName = (modelId: string): string => {
  if (modelId.startsWith('gpt-')) {
    return modelId
      .replace(/^gpt-/, 'GPT ')
      .replace(/-mini$/, ' Mini')
      .replace(/-nano$/, ' Nano')
      .replace(/-chat-latest$/, '');
  }
  if (modelId.startsWith('o')) {
    return modelId.toLowerCase();
  }
  if (modelId.startsWith('claude-')) {
    return modelId.replace(/^claude-/, 'Claude ').replace(/-/g, ' ').replace(/\b([a-z])/g, (m) => m.toUpperCase());
  }
  if (modelId.startsWith('gemini-')) {
    return modelId.replace(/^gemini-/, 'Gemini ').replace(/-/g, ' ').replace(/\b([a-z])/g, (m) => m.toUpperCase());
  }
  if (modelId.startsWith('gemma-')) {
    return modelId.replace(/^gemma-/, 'Gemma ').replace(/-/g, ' ').replace(/\b([a-z])/g, (m) => m.toUpperCase());
  }
  if (modelId.startsWith('llama-')) {
    return modelId.replace(/^llama-/, 'Llama ').replace(/-/g, ' ').replace(/\b([a-z])/g, (m) => m.toUpperCase());
  }
  if (modelId.startsWith('deepseek-')) {
    return modelId.replace(/^deepseek-/, 'DeepSeek ').replace(/-/g, ' ').replace(/\b([a-z])/g, (m) => m.toUpperCase());
  }
  return kModelFamilyTitle(modelId);
};

const inferVendor = (modelId: string): ModelVendor => {
  if (modelId.startsWith('gpt-') || modelId.startsWith('o')) return 'openai';
  if (modelId.startsWith('gemini-') || modelId.startsWith('gemma-')) return 'google';
  if (modelId.startsWith('claude-')) return 'anthropic';
  if (modelId.startsWith('llama-')) return 'meta';
  if (modelId.startsWith('deepseek-')) return 'deepseek';
  return 'unknown';
};

const normalizeModelEntry = (entry: ModelCatalogEntry): NormalizedModelCatalogEntry => {
  const vendor = entry.vendor ?? inferVendor(entry.model);
  const displayName = entry.displayName ?? formatModelDisplayName(entry.model);
  return { ...entry, vendor, displayName };
};

export const kModelCatalog: NormalizedModelCatalogEntry[] = (costs as ModelCatalogEntry[]).map(
  normalizeModelEntry
);

export const getModelById = (modelId: string): NormalizedModelCatalogEntry | undefined =>
  kModelCatalog.find((entry) => entry.model === modelId);

export const isKnownModel = (modelId: string): boolean => Boolean(getModelById(modelId));

/** Return the ordered list of providers for a model. */
export const getModelProviders = (modelId: string): ModelProviderEntry[] =>
  getModelById(modelId)?.providers ?? [];

export const getOpenRouterModelId = (modelId: string): string => {
  const orProvider = getModelProviders(modelId).find(p => p.name === 'openrouter');
  return orProvider?.providerModelId ?? modelId;
};

export const isOpenAIModel = (modelId: string): boolean =>
  getModelProviders(modelId)[0]?.name === 'openai';

export const isGeminiModel = (modelId: string): boolean =>
  getModelProviders(modelId)[0]?.name === 'gemini';

export const isOpenRouterModel = (modelId: string): boolean =>
  getModelProviders(modelId)[0]?.name === 'openrouter';

