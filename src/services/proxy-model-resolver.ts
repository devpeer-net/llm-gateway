import { config, ProxyModelConfig } from '../config';

/**
 * Proxy model resolver with round-robin fallback on 429 (rate limit) errors.
 *
 * Proxy models (e.g. "gateway-fast") are virtual model IDs that map to a
 * rotating list of real models, defined purely in configuration (see
 * `config.proxyModels`, overridable via `PROXY_MODELS_JSON`). When the upstream
 * provider returns 429, the resolver advances to the next model in the list.
 */

/** Module-level round-robin cursor per proxy id (kept out of the config object). */
const roundRobinIndex: Record<string, number> = {};

const getConfig = (proxyId: string): ProxyModelConfig | undefined => config.proxyModels[proxyId];

const getIndex = (proxyId: string): number => roundRobinIndex[proxyId] ?? 0;

/** Check whether a model ID is a proxy that needs resolution. */
export const isProxyModel = (modelId: string): boolean => Boolean(getConfig(modelId));

/** Return how many fallback models a proxy has. */
export const getProxyModelCount = (proxyId: string): number => getConfig(proxyId)?.models.length ?? 0;

/**
 * Get the current model for a proxy ID without advancing the index.
 * Returns `undefined` if the model is not a proxy.
 */
export const resolveProxyModel = (proxyId: string): string | undefined => {
  const cfg = getConfig(proxyId);
  if (!cfg || cfg.models.length === 0) return undefined;
  return cfg.models[getIndex(proxyId) % cfg.models.length];
};

/**
 * Advance the round-robin index and return the next model.
 * Used after a 429 to switch to the next provider.
 */
export const advanceProxyModel = (proxyId: string): string | undefined => {
  const cfg = getConfig(proxyId);
  if (!cfg || cfg.models.length === 0) return undefined;
  roundRobinIndex[proxyId] = (getIndex(proxyId) + 1) % cfg.models.length;
  return cfg.models[roundRobinIndex[proxyId]];
};

/**
 * Return the full list of models for a proxy, ordered starting from the current
 * round-robin position. Used to build a per-request snapshot so that concurrent
 * advances don't cause a request to retry the same model.
 */
export const getProxyModelList = (proxyId: string): string[] => {
  const cfg = getConfig(proxyId);
  if (!cfg || cfg.models.length === 0) return [];
  const { models } = cfg;
  const start = getIndex(proxyId) % models.length;
  return [...models.slice(start), ...models.slice(0, start)];
};

/**
 * Return the OpenRouter fallback model ID for a proxy, or undefined if none is
 * configured. Used after all direct models have been exhausted.
 */
export const getOpenRouterFallback = (proxyId: string): string | undefined =>
  getConfig(proxyId)?.openRouterFallback;

/** Test helper: reset all round-robin cursors to their initial position. */
export const __resetProxyRoundRobin = (): void => {
  for (const key of Object.keys(roundRobinIndex)) {
    delete roundRobinIndex[key];
  }
};
