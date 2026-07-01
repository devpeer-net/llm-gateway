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

export type QuotaStoreKind = 'memory' | 'dynamodb';

const resolveQuotaStore = (): QuotaStoreKind => {
  const kind = (process.env.QUOTA_STORE || 'memory').toLowerCase();
  return kind === 'dynamodb' ? 'dynamodb' : 'memory';
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
    userIdClaim: process.env.AUTH_USER_ID_CLAIM || 'sub',
    devUserId: process.env.AUTH_DEV_USER_ID || 'local-dev',
  },

  quota: {
    store: resolveQuotaStore(),
    apiUsageTable: process.env.API_USAGE_TABLE || 'apiUsage',
    awsRegion: process.env.AWS_REGION || 'us-east-1',
  },

  proxyModels: parseProxyModels(),
};

export type GatewayConfig = typeof config;
