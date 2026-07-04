import { LLMModel, ModelCost, ModelEngine, ModelVendor } from '../types';
import costsData from './costs/costs.json';

export interface ModelCatalogEntry extends ModelCost {
  displayName?: string;
  vendor?: ModelVendor;
  engine?: ModelEngine;
  openRouterModel?: string;
  legacy?: boolean;
}

export interface NormalizedModelCatalogEntry extends ModelCatalogEntry {
  displayName: string;
  vendor: ModelVendor;
  engine: ModelEngine;
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

const inferEngine = (entry: ModelCatalogEntry): ModelEngine => {
  if (entry.engine) return entry.engine;
  if (entry.openRouterModel) return 'openrouter';
  const vendor = entry.vendor ?? inferVendor(entry.model);
  if (vendor === 'google' && entry.model.startsWith('gemini-')) return 'gemini';
  return 'openai';
};

const normalizeModelEntry = (entry: ModelCatalogEntry): NormalizedModelCatalogEntry => {
  const vendor = entry.vendor ?? inferVendor(entry.model);
  const displayName = entry.displayName ?? formatModelDisplayName(entry.model);
  const engine = inferEngine({ ...entry, vendor });
  return { ...entry, vendor, displayName, engine };
};

export const kModelCatalog: NormalizedModelCatalogEntry[] = (costs as ModelCatalogEntry[]).map(
  normalizeModelEntry
);

export const getModelCatalog = (): NormalizedModelCatalogEntry[] => kModelCatalog;

export const getModelById = (modelId: string): NormalizedModelCatalogEntry | undefined =>
  kModelCatalog.find((entry) => entry.model === modelId);

export const isKnownModel = (modelId: string): boolean => Boolean(getModelById(modelId));

export const getModelDisplayName = (modelId: string): string =>
  getModelById(modelId)?.displayName ?? modelId;

export const getModelEngine = (modelId: string): ModelEngine | undefined =>
  getModelById(modelId)?.engine;

export const isOpenAIModel = (modelId: string): boolean =>
  getModelById(modelId)?.engine === 'openai';

export const isGeminiModel = (modelId: string): boolean =>
  getModelById(modelId)?.engine === 'gemini';

export const isOpenRouterModel = (modelId: string): boolean =>
  getModelById(modelId)?.engine === 'openrouter';

export const getOpenRouterModelId = (modelId: string): string =>
  getModelById(modelId)?.openRouterModel ?? modelId;

