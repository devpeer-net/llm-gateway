import { describe, it, expect, jest } from '@jest/globals';
import type { Request } from 'express';

// Ensure the quota logic runs in tests.
process.env.JEST_WORKER_ID = process.env.JEST_WORKER_ID || '1';

import {
  hasEnoughCredits,
  resolveApiType,
  shouldRateLimit,
  getRecentUsage,
  kLlmRateLimitThreshold,
} from './quota-handlers';
import { ApiType, SubscriptionPlan } from '../types';
import { kChatCompletionsPath } from '../paths';

describe('hasEnoughCredits', () => {
  it('returns true if usage + estimated <= quota', () => {
    const req = { path: kChatCompletionsPath, body: { model: 'gpt-4o-mini', messages: [{ content: 'Hi' }] } } as Request;
    const usage = { usageCount: 5, quota: 100, bonusCredits: 0 };
    expect(hasEnoughCredits(usage as any, req)).toBe(true);
  });

  it('returns false if usage + estimated > quota and bonusCredits < estimated', () => {
    const req = {
      path: kChatCompletionsPath,
      body: { model: 'gpt-4o-mini', messages: [{ content: 'Lorem ipsum sit amet dolor priscit lol omg rofl' }] },
    } as Request;
    const usage = { usageCount: 9, quota: 10, bonusCredits: 2 };
    expect(hasEnoughCredits(usage as any, req)).toBe(false);
  });

  it('returns true if bonusCredits >= estimated', () => {
    const req = { path: kChatCompletionsPath, body: { model: 'gpt-4o-mini', messages: [{ content: 'Hi' }] } } as Request;
    const usage = { usageCount: 9, quota: 10, bonusCredits: 1000 };
    expect(hasEnoughCredits(usage as any, req)).toBe(true);
  });
});

describe('resolveApiType', () => {
  it('resolves a chat model to its ApiType', () => {
    const req = { path: kChatCompletionsPath, body: { model: 'gpt-4o-mini' } } as Request;
    expect(resolveApiType(req)).toBe(ApiType.SMALL_LLM);
  });

  it('resolves a proxy model via its primary underlying model', () => {
    const req = { path: kChatCompletionsPath, body: { model: 'gateway-fast' } } as Request;
    expect(resolveApiType(req)).toBe(ApiType.SMALL_LLM);
  });

  it('throws for an unknown path', () => {
    const req = { path: '/some-unknown-path', body: {} } as Request;
    expect(() => resolveApiType(req)).toThrow();
  });
});

describe('getRecentUsage', () => {
  const now = Date.now();

  it('sums usage within the window', () => {
    const apiUsage = {
      requests: [
        { usage: 100, timestamp: now },
        { usage: 50, timestamp: now - 3 * 60 * 60 * 1000 },
        { usage: 999, timestamp: now - 10 * 60 * 60 * 1000 },
      ],
    } as any;
    expect(getRecentUsage(apiUsage, 4)).toBe(150);
  });

  it('returns 0 when there are no requests', () => {
    expect(getRecentUsage({ requests: [] } as any, 4)).toBe(0);
  });
});

describe('shouldRateLimit', () => {
  const now = Date.now();

  it('returns false for FREE plan regardless of usage', () => {
    const apiUsage = {
      plan: SubscriptionPlan.FREE,
      apiType: ApiType.SMALL_LLM,
      requests: [{ usage: kLlmRateLimitThreshold + 1, timestamp: now }],
    };
    expect(shouldRateLimit(apiUsage as any)).toBe(false);
  });

  it('returns true for SMALL_LLM when recent usage exceeds the threshold', () => {
    const apiUsage = {
      plan: SubscriptionPlan.BASIC,
      apiType: ApiType.SMALL_LLM,
      requests: [{ usage: kLlmRateLimitThreshold + 1, timestamp: now }],
    };
    expect(shouldRateLimit(apiUsage as any)).toBe(true);
  });

  it('returns false for SMALL_LLM when recent usage is under the threshold', () => {
    const apiUsage = {
      plan: SubscriptionPlan.BASIC,
      apiType: ApiType.SMALL_LLM,
      requests: [{ usage: kLlmRateLimitThreshold / 2, timestamp: now }],
    };
    expect(shouldRateLimit(apiUsage as any)).toBe(false);
  });

  it('returns true for a paid plan and unsupported API type', () => {
    const apiUsage = { plan: SubscriptionPlan.BASIC, apiType: ApiType.BIG_LLM, requests: [] };
    expect(shouldRateLimit(apiUsage as any)).toBe(true);
  });

  it('returns false when the requests array is missing or empty', () => {
    expect(shouldRateLimit({ plan: SubscriptionPlan.BASIC, apiType: ApiType.SMALL_LLM } as any)).toBe(false);
  });
});

describe('enforcement flag (fail closed)', () => {
  const chatReq = {
    path: kChatCompletionsPath,
    body: { model: 'gpt-4o-mini', messages: [{ content: 'Lorem ipsum sit amet dolor priscit lol omg rofl' }] },
  } as Request;
  const overQuota = { usageCount: 9, quota: 10, bonusCredits: 2 } as any;
  const rateLimited = {
    plan: SubscriptionPlan.BASIC,
    apiType: ApiType.SMALL_LLM,
    requests: [{ usage: kLlmRateLimitThreshold + 1, timestamp: Date.now() }],
  } as any;

  const withEnforcement = (value: string | undefined, fn: (m: typeof import('./quota-handlers')) => void): void => {
    const prev = process.env.QUOTA_ENFORCEMENT;
    if (value === undefined) delete process.env.QUOTA_ENFORCEMENT;
    else process.env.QUOTA_ENFORCEMENT = value;
    jest.isolateModules(() => {
      fn(require('./quota-handlers'));
    });
    if (prev === undefined) delete process.env.QUOTA_ENFORCEMENT;
    else process.env.QUOTA_ENFORCEMENT = prev;
  };

  it('enforces by default when QUOTA_ENFORCEMENT is unset (fail closed)', () => {
    withEnforcement(undefined, (m) => {
      expect(m.hasEnoughCredits(overQuota, chatReq)).toBe(false);
      expect(m.shouldRateLimit(rateLimited)).toBe(true);
    });
  });

  it('bypasses checks only when QUOTA_ENFORCEMENT is explicitly off', () => {
    withEnforcement('off', (m) => {
      expect(m.hasEnoughCredits(overQuota, chatReq)).toBe(true);
      expect(m.shouldRateLimit(rateLimited)).toBe(false);
    });
  });
});
