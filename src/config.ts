/**
 * Environment-driven configuration for the gateway.
 *
 * Every tunable knob is read from `process.env` with a safe default so the
 * service runs out-of-the-box for local/dev (no auth, in-memory quota) while
 * remaining fully configurable for production deployments.
 */

/** Configuration for a single proxy (virtual) model. */
export interface ProxyModelConfig {
  /** Ordered list of real model IDs to rotate through on 429. */
  models: string[];
  /**
   * Optional OpenRouter model ID to fall back to when every direct model has
   * returned 429. E.g. 'google/gemini-2.5-flash'.
   */
  openRouterFallback?: string;
}

const num = (value: string | undefined, fallback: number): number => {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

/**
 * Default, de-branded proxy-model registry. Overridable in full via the
 * `PROXY_MODELS_JSON` environment variable (a JSON object keyed by proxy id).
 */
const defaultProxyModels: Record<string, ProxyModelConfig> = {
  'gateway-fast': {
    models: ['gemini-2.5-flash', 'gemini-2.0-flash', 'gpt-4o-mini'],
    openRouterFallback: 'google/gemini-2.5-flash',
  },
  'gateway-chat': {
    models: ['gpt-4o-mini'],
    openRouterFallback: 'openai/gpt-4o-mini',
  },
};

const parseProxyModels = (): Record<string, ProxyModelConfig> => {
  const raw = process.env.PROXY_MODELS_JSON;
  if (!raw) return defaultProxyModels;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed as Record<string, ProxyModelConfig>;
    }
    console.error('PROXY_MODELS_JSON is not a JSON object; using defaults.');
  } catch (error) {
    console.error('Failed to parse PROXY_MODELS_JSON; using defaults.', error);
  }
  return defaultProxyModels;
};

export type AuthMode = 'jwt' | 'none';

const resolveAuthMode = (): AuthMode => {
  if (process.env.AUTH_DISABLED === 'true') return 'none';
  const mode = (process.env.AUTH_MODE || 'jwt').toLowerCase();
  return mode === 'none' ? 'none' : 'jwt';
};

const parseAlgorithms = (): string[] | undefined => {
  const raw = process.env.AUTH_JWT_ALGORITHMS;
  if (!raw) return undefined;
  const list = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return list.length > 0 ? list : undefined;
};

export type QuotaStoreKind = 'memory' | 'dynamodb';

const resolveQuotaStore = (): QuotaStoreKind => {
  const kind = (process.env.QUOTA_STORE || 'memory').toLowerCase();
  return kind === 'dynamodb' ? 'dynamodb' : 'memory';
};

const resolveQuotaEnforcement = (): boolean => {
  // Fail closed: quota/credit and rate-limit enforcement is ON unless it is
  // explicitly disabled. This prevents a deploy that forgets to set
  // NODE_ENV=production from silently running with all spend checks off.
  const raw = (process.env.QUOTA_ENFORCEMENT || '').trim().toLowerCase();
  const disabled = raw === 'off' || raw === 'false' || raw === 'no' || raw === '0';
  if (disabled && process.env.NODE_ENV === 'production') {
    console.warn(
      'WARNING: QUOTA_ENFORCEMENT is disabled while NODE_ENV=production — quota and rate limiting are OFF.'
    );
  }
  return !disabled;
};

export const config = {
  port: num(process.env.PORT, 3333),
  trustProxyHops: num(process.env.TRUST_PROXY_HOPS, 0),
  jsonBodyLimit: process.env.JSON_BODY_LIMIT || '10mb',
  requestTimeoutMs: num(process.env.REQUEST_TIMEOUT_MS, 300000),

  rateLimit: {
    windowMs: num(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    max: num(process.env.RATE_LIMIT_MAX, 450),
  },

  auth: {
    mode: resolveAuthMode(),
    jwksUrl: process.env.AUTH_JWKS_URL,
    publicKey: process.env.AUTH_JWT_PUBLIC_KEY,
    secret: process.env.AUTH_JWT_SECRET,
    issuer: process.env.AUTH_JWT_ISSUER,
    audience: process.env.AUTH_JWT_AUDIENCE,
    algorithms: parseAlgorithms(),
    userIdClaim: process.env.AUTH_USER_ID_CLAIM || 'sub',
    devUserId: process.env.AUTH_DEV_USER_ID || 'local-dev',
  },

  quota: {
    store: resolveQuotaStore(),
    enforcement: resolveQuotaEnforcement(),
    apiUsageTable: process.env.API_USAGE_TABLE || 'apiUsage',
    awsRegion: process.env.AWS_REGION || 'us-east-1',
  },

  proxyModels: parseProxyModels(),
};

// Snapshot startup environment used for security assertions (config is loaded
// once at process start, so these reflect the deploy's environment).
const kNodeEnv = process.env.NODE_ENV;
const kAllowNoAuth = process.env.ALLOW_NO_AUTH;

/**
 * Fail fast on an insecure production configuration. No-auth mode must never be
 * used when `NODE_ENV=production` unless it is deliberately overridden with
 * `ALLOW_NO_AUTH=true`. Throws so the caller can abort startup.
 */
export const assertSecureConfig = (): void => {
  if (config.auth.mode === 'none' && kNodeEnv === 'production' && kAllowNoAuth !== 'true') {
    throw new Error(
      'AUTH_MODE=none (no authentication) is not permitted when NODE_ENV=production. ' +
        'Set AUTH_MODE=jwt, or set ALLOW_NO_AUTH=true to explicitly override.'
    );
  }
};
