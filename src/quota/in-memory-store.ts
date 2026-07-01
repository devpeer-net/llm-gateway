import { ApiType, ApiUsage, Period, SubscriptionPlan } from '../types';
import {
  kDefaultMonthlyQuota,
  kPeriodSeconds,
  kUnlimitedQuotaValue,
  NoUsageRecordError,
  QuotaStore,
} from './quota-store';

/**
 * Process-local, Map-backed quota store for local/dev, tests and self-hosters
 * that don't need durable quota. State is non-persistent. Provisioned records
 * carry a generous quota so local/dev and the e2e suite run without limits.
 */
export class InMemoryQuotaStore implements QuotaStore {
  private readonly usages = new Map<string, ApiUsage>();

  private key(userId: string, apiType: ApiType): string {
    return `${userId}:${apiType}`;
  }

  async getUserQuota(userId: string, apiType: ApiType): Promise<ApiUsage> {
    const usage = this.usages.get(this.key(userId, apiType));
    if (!usage) {
      throw new NoUsageRecordError(userId, apiType);
    }
    return usage;
  }

  async updateApiUsage(userId: string, apiType: ApiType, credits: number): Promise<void> {
    const key = this.key(userId, apiType);
    let usage = this.usages.get(key);
    if (!usage) {
      usage = await this.provisionQuota(userId, apiType);
    }
    const now = Date.now();
    usage.usageCount += credits;
    usage.lastRequestAt = new Date(now).toISOString();
    usage.updatedAt = new Date(now).toISOString();
    usage.requests = usage.requests ?? [];
    usage.requests.push({ usage: credits, timestamp: now });
  }

  async resetQuota(userId: string, usage: ApiUsage): Promise<void> {
    const key = this.key(userId, usage.apiType);
    const existing = this.usages.get(key) ?? usage;
    existing.usageCount = 0;
    existing.periodStart = new Date().toISOString();
    existing.updatedAt = new Date().toISOString();
    this.usages.set(key, existing);
  }

  async provisionQuota(userId: string, apiType: ApiType): Promise<ApiUsage> {
    const currentDateStr = new Date().toISOString();
    const usage: ApiUsage = {
      userId,
      apiType,
      plan: SubscriptionPlan.FREE,
      usageCount: 0,
      quota: kUnlimitedQuotaValue > kDefaultMonthlyQuota ? kUnlimitedQuotaValue : kDefaultMonthlyQuota,
      period: Period.MONTH,
      periodSeconds: kPeriodSeconds[Period.MONTH],
      periodStart: currentDateStr,
      bonusCredits: 0,
      lastRequestAt: null,
      createdAt: currentDateStr,
      updatedAt: currentDateStr,
      requests: [],
    };
    this.usages.set(this.key(userId, apiType), usage);
    return usage;
  }
}
