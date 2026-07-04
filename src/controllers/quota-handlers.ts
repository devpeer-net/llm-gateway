import { Request, Response } from 'express';
import { ApiUsage, ChatRequestBody, SubscriptionPlan, SystemMessageType } from '../types';
import {
  getQuotaStore,
  kNoUsageRecordErrorName,
  shouldResetQuota,
} from '../quota/quota-store';
import { ChatCompletion, CompletionUsage } from 'openai/resources';
import { calculateCredits, estimateCredits } from '../services/credits-service';
import { config } from '../config';

const kQuotaExceededError = 'User has exceeded the quota';
const kRateLimitExceededError = 'Rate limit exceeded';

export const kLlmRateLimitThreshold = 25_000_000; // tokens in the aggregation window

const store = getQuotaStore();

export const hasEnoughCredits = (usage: ApiUsage, req: Request): boolean => {
  // Fail closed: only bypass the check when enforcement is explicitly disabled.
  if (!config.quota.enforcement) {
    return true;
  }

  const estimatedCredits = estimateCredits(req);
  return (
    usage.usageCount + estimatedCredits <= usage.quota ||
    (usage.bonusCredits > 0 && usage.bonusCredits >= estimatedCredits)
  );
};


export const handleNoUsage = async (
  userId: string,
  res: Response
): Promise<boolean> => {
  try {
    res.locals.logger.error(`No usage record found for user ${userId}. Provisioning default quota...`);
    await store.provisionQuota(userId);
  } catch (error) {
    res.locals.logger.error('Error provisioning default quota:', error);
    res.status(429).json({ error: kQuotaExceededError });
    return false;
  }
  return true;
};

/**
 * Total quota usage in the last n hours from apiUsage.requests.
 */
export const getRecentUsage = (apiUsage: ApiUsage, n: number): number => {
  if (!apiUsage.requests || apiUsage.requests.length === 0) {
    return 0;
  }
  const AGGREGATION_WINDOW_MS = n * 60 * 60 * 1000;
  const now = Date.now();
  return apiUsage.requests
    .filter((record) => now - record.timestamp <= AGGREGATION_WINDOW_MS)
    .reduce((sum, record) => sum + record.usage, 0);
};

export const shouldRateLimit = (apiUsage: ApiUsage): boolean => {
  // Fail closed: only skip rate limiting when enforcement is explicitly disabled.
  if (!config.quota.enforcement) {
    return false;
  }

  // Free plan has its own quota limits; only paid plans use throughput rate limiting.
  if (apiUsage.plan !== SubscriptionPlan.FREE) {
    const recentUsage4Hours = getRecentUsage(apiUsage, 4);
    return recentUsage4Hours > kLlmRateLimitThreshold;
  }
  return false;
};

export const quotaHandler = async (req: Request, res: Response, next: any): Promise<void> => {
  const user = res.locals.user;
  const userId = user.sub;

  try {
    res.locals.resetQuotaPromise = Promise.resolve();
    const apiUsage: ApiUsage = await store.getUserQuota(userId);
    res.locals.apiUsage = apiUsage;

    if (shouldResetQuota(apiUsage)) {
      res.locals.logger.log('Resetting quota...');
      apiUsage.usageCount = 0;
      res.locals.resetQuotaPromise = store
        .resetQuota(userId, apiUsage)
        .catch((error: any) => res.locals.logger.error(`Error resetting quota for user ${userId}:`, error));
    }

    if (!hasEnoughCredits(apiUsage, req)) {
      res.status(429).json({ error: kQuotaExceededError });
      return;
    }

    if (shouldRateLimit(apiUsage)) {
      res.locals.logger.warn('Rate limit exceeded for user:', userId);
      res.status(429).json({ error: kRateLimitExceededError, errorType: SystemMessageType.RATE_LIMIT_EXCEEDED });
      return;
    }
  } catch (error: any) {
    if (error.name === kNoUsageRecordErrorName) {
      if (!(await handleNoUsage(userId, res))) {
        return;
      }
    } else {
      res.locals.logger.error('Error checking user quota:', error);
      res.status(500).json({ error: 'Error checking user quota' });
      return;
    }
  }

  next();
};

export const updateChatQuotaHandler = async (req: Request, res: Response): Promise<void> => {
  const user = res.locals.user;
  const genRes: ChatCompletion = res.locals.generateResponse;

  try {
    await res.locals.resetQuotaPromise;
    const usage: CompletionUsage = genRes.usage!;
    res.locals.logger.log('Updating chat API usage:', usage);
    // Fire and forget.
    store
      .updateApiUsage(user.sub, calculateCredits(req.body.model, usage))
      .catch((error: Error) => res.locals.logger.error('Error updating chat API usage:', error));
  } catch (error: any) {
    res.locals.logger.error('Error recording API usage:', error);
  }
};
