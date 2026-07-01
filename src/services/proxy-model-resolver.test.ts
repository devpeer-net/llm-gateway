import {
  isProxyModel,
  resolveProxyModel,
  advanceProxyModel,
  getProxyModelCount,
  getProxyModelList,
  getOpenRouterFallback,
  __resetProxyRoundRobin,
} from './proxy-model-resolver';

describe('proxy-model-resolver', () => {
  beforeEach(() => {
    __resetProxyRoundRobin();
  });

  describe('isProxyModel', () => {
    it('returns true for a configured proxy id', () => {
      expect(isProxyModel('gateway-fast')).toBe(true);
    });

    it('returns false for regular models', () => {
      expect(isProxyModel('gemini-2.5-flash')).toBe(false);
      expect(isProxyModel('gpt-4o-mini')).toBe(false);
    });
  });

  describe('getProxyModelCount', () => {
    it('returns the number of models for a proxy', () => {
      expect(getProxyModelCount('gateway-fast')).toBeGreaterThan(0);
    });

    it('returns 0 for unknown proxy', () => {
      expect(getProxyModelCount('unknown-proxy')).toBe(0);
    });
  });

  describe('resolveProxyModel', () => {
    it('returns a model from the list', () => {
      const model = resolveProxyModel('gateway-fast');
      expect(model).toBeDefined();
      expect(typeof model).toBe('string');
    });

    it('returns undefined for non-proxy models', () => {
      expect(resolveProxyModel('gpt-4o-mini')).toBeUndefined();
    });
  });

  describe('advanceProxyModel', () => {
    it('returns a different model after advancing', () => {
      const first = resolveProxyModel('gateway-fast');
      advanceProxyModel('gateway-fast');
      const second = resolveProxyModel('gateway-fast');
      expect(second).toBeDefined();
      if (getProxyModelCount('gateway-fast') > 1) {
        expect(second).not.toBe(first);
      }
    });

    it('wraps around after exhausting the list', () => {
      const count = getProxyModelCount('gateway-fast');
      const first = resolveProxyModel('gateway-fast');
      for (let i = 0; i < count; i++) {
        advanceProxyModel('gateway-fast');
      }
      expect(resolveProxyModel('gateway-fast')).toBe(first);
    });

    it('returns undefined for non-proxy models', () => {
      expect(advanceProxyModel('unknown')).toBeUndefined();
    });
  });

  describe('getProxyModelList', () => {
    it('returns all models starting from the current index', () => {
      const list = getProxyModelList('gateway-fast');
      const count = getProxyModelCount('gateway-fast');
      expect(list).toHaveLength(count);
      expect(list[0]).toBe(resolveProxyModel('gateway-fast'));
    });

    it('returns a rotated list after advancing', () => {
      const before = getProxyModelList('gateway-fast');
      advanceProxyModel('gateway-fast');
      const after = getProxyModelList('gateway-fast');
      if (before.length > 1) {
        expect(after[0]).toBe(before[1]);
      }
    });

    it('contains no duplicates', () => {
      const list = getProxyModelList('gateway-fast');
      expect(new Set(list).size).toBe(list.length);
    });

    it('returns empty array for unknown proxy', () => {
      expect(getProxyModelList('unknown')).toEqual([]);
    });
  });

  describe('single-model proxy (gateway-chat)', () => {
    it('is recognized as a proxy model', () => {
      expect(isProxyModel('gateway-chat')).toBe(true);
    });

    it('resolves to a defined model string', () => {
      const model = resolveProxyModel('gateway-chat');
      expect(model).toBeDefined();
      expect(typeof model).toBe('string');
    });

    it('has at least 1 model in the rotation', () => {
      expect(getProxyModelCount('gateway-chat')).toBeGreaterThanOrEqual(1);
    });

    it('wraps back to the same model after a full rotation', () => {
      const count = getProxyModelCount('gateway-chat');
      const first = resolveProxyModel('gateway-chat');
      for (let i = 0; i < count; i++) {
        advanceProxyModel('gateway-chat');
      }
      expect(resolveProxyModel('gateway-chat')).toBe(first);
    });
  });

  describe('getOpenRouterFallback', () => {
    it('returns the configured OpenRouter fallback for gateway-fast', () => {
      expect(getOpenRouterFallback('gateway-fast')).toBe('google/gemini-2.5-flash');
    });

    it('returns the configured OpenRouter fallback for gateway-chat', () => {
      expect(getOpenRouterFallback('gateway-chat')).toBe('openai/gpt-4o-mini');
    });

    it('returns undefined for an unknown proxy', () => {
      expect(getOpenRouterFallback('unknown-proxy')).toBeUndefined();
    });
  });
});
