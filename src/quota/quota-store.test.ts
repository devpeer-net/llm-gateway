import { InMemoryQuotaStore } from './in-memory-store';
import { getQuotaStore, NoUsageRecordError } from './quota-store';

describe('InMemoryQuotaStore', () => {
  it('throws NoUsageRecordError when no record exists', async () => {
    const store = new InMemoryQuotaStore();
    await expect(store.getUserQuota('u1')).rejects.toBeInstanceOf(NoUsageRecordError);
  });

  it('provisions a generous default quota', async () => {
    const store = new InMemoryQuotaStore();
    const usage = await store.provisionQuota('u1');
    expect(usage.userId).toBe('u1');
    expect(usage.quota).toBeGreaterThan(0);
    expect(usage.usageCount).toBe(0);

    const fetched = await store.getUserQuota('u1');
    expect(fetched.quota).toBe(usage.quota);
  });

  it('records usage and resets it', async () => {
    const store = new InMemoryQuotaStore();
    await store.provisionQuota('u2');
    await store.updateApiUsage('u2', 42);

    let usage = await store.getUserQuota('u2');
    expect(usage.usageCount).toBe(42);
    expect(usage.requests?.length).toBe(1);

    await store.resetQuota('u2', usage);
    usage = await store.getUserQuota('u2');
    expect(usage.usageCount).toBe(0);
  });

  it('auto-provisions on updateApiUsage for an unknown user', async () => {
    const store = new InMemoryQuotaStore();
    await store.updateApiUsage('u3', 10);
    const usage = await store.getUserQuota('u3');
    expect(usage.usageCount).toBe(10);
  });
});

describe('getQuotaStore factory', () => {
  it('returns a store implementing the QuotaStore interface (memory by default)', () => {
    const store = getQuotaStore();
    expect(typeof store.getUserQuota).toBe('function');
    expect(typeof store.updateApiUsage).toBe('function');
    expect(typeof store.resetQuota).toBe('function');
    expect(typeof store.provisionQuota).toBe('function');
  });

  it('returns the same singleton instance', () => {
    expect(getQuotaStore()).toBe(getQuotaStore());
  });
});
