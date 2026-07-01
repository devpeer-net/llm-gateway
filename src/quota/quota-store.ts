import { ApiType, ApiUsage, Period } from '../types';
import { config } from '../config';
import { getApiTypeForModel } from '../llm/model-catalog';

// ─── Quota constants ────────────────────────────────────────────────────────

export const kDefaultMonthlyQuota = 10_000_000;
export const kUnlimitedQuotaValue = 1_000_000_000;

export const kPeriodSeconds: Record<Period, number> = {
  [Period.DAY]: 60 * 60 * 24,
  [Period.WEEK]: 60 * 60 * 24 * 7,
  [Period.MONTH]: 60 * 60 * 24 * 30,
};

// ─── Errors ─────────────────────────────────────────────────────────────────

export const kNoUsageRecordErrorName = 'NoUsageRecordError';

export class NoUsageRecordError extends Error {
  constructor(userId: string, apiType: string) {
    super(`No usage record found for user: ${userId} and API: ${apiType}`);
    this.name = kNoUsageRecordErrorName;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Resolve a real model id to its ApiType bucket. */
export const getApiType = (modelName: string): ApiType => getApiTypeForModel(modelName);

/** Pure check: has the current quota window elapsed? */
export const shouldResetQuota = (usage: ApiUsage): boolean => {
  const now = new Date();
  const periodStart = new Date(usage.periodStart);
  const periodEnd = new Date(periodStart.getTime() + kPeriodSeconds[usage.period] * 1000);
  return now > periodEnd;
};

// ─── Store abstraction ──────────────────────────────────────────────────────

/**
 * Backend-agnostic persistence surface for quota accounting. Concrete
 * implementations are selected by config (`QUOTA_STORE`).
 */
export interface QuotaStore {
  /** Load usage for a user + ApiType. Throws {@link NoUsageRecordError} if none exists. */
  getUserQuota(userId: string, apiType: ApiType): Promise<ApiUsage>;
  /** Record consumed credits (fire-and-forget from the caller's perspective). */
  updateApiUsage(userId: string, apiType: ApiType, credits: number): Promise<void>;
  /** Reset the usage counter for a new period. */
  resetQuota(userId: string, usage: ApiUsage): Promise<void>;
  /** Create and persist a default quota record for a user + ApiType. */
  provisionQuota(userId: string, apiType: ApiType): Promise<ApiUsage>;
}

let cachedStore: QuotaStore | undefined;

/** Return the configured quota store singleton. */
export const getQuotaStore = (): QuotaStore => {
  if (cachedStore) return cachedStore;

  if (config.quota.store === 'dynamodb') {
    // Lazily require so the optional AWS SDK is only loaded when selected.
    const { DynamoQuotaStore } = require('./dynamo-store');
    cachedStore = new DynamoQuotaStore();
  } else {
    const { InMemoryQuotaStore } = require('./in-memory-store');
    cachedStore = new InMemoryQuotaStore();
  }
  return cachedStore!;
};

/** Test helper to reset the cached singleton between test cases. */
export const __resetQuotaStore = (): void => {
  cachedStore = undefined;
};
