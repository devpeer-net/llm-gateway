import { describe, it, expect, jest } from '@jest/globals';

/** Load a fresh config module with the given env applied. */
const loadConfig = (env: Record<string, string | undefined>) => {
  let mod: typeof import('./config');
  const prev = { ...process.env };
  jest.isolateModules(() => {
    Object.assign(process.env, env);
    mod = require('./config');
  });
  // Restore env keys that were unset before.
  for (const key of Object.keys(env)) {
    if (prev[key] === undefined) delete process.env[key];
    else process.env[key] = prev[key];
  }
  return mod!;
};

describe('assertSecureConfig', () => {
  it('throws when AUTH_MODE=none in production without an override', () => {
    const { assertSecureConfig } = loadConfig({
      AUTH_MODE: 'none',
      NODE_ENV: 'production',
      ALLOW_NO_AUTH: undefined,
    });
    expect(() => assertSecureConfig()).toThrow(/not permitted when NODE_ENV=production/);
  });

  it('allows AUTH_MODE=none in production when ALLOW_NO_AUTH=true', () => {
    const { assertSecureConfig } = loadConfig({
      AUTH_MODE: 'none',
      NODE_ENV: 'production',
      ALLOW_NO_AUTH: 'true',
    });
    expect(() => assertSecureConfig()).not.toThrow();
  });

  it('allows AUTH_MODE=none outside production', () => {
    const { assertSecureConfig } = loadConfig({
      AUTH_MODE: 'none',
      NODE_ENV: 'development',
      ALLOW_NO_AUTH: undefined,
    });
    expect(() => assertSecureConfig()).not.toThrow();
  });

  it('allows AUTH_MODE=jwt in production', () => {
    const { assertSecureConfig } = loadConfig({
      AUTH_MODE: 'jwt',
      NODE_ENV: 'production',
      ALLOW_NO_AUTH: undefined,
    });
    expect(() => assertSecureConfig()).not.toThrow();
  });
});
