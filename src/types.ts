import { ChatCompletionMessageParam, ChatCompletionMessageToolCall } from 'openai/resources';

// ─── Errors ─────────────────────────────────────────────────────────────────

export class HttpApiError extends Error {
  public statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

// ─── Auth ───────────────────────────────────────────────────────────────────

export interface AuthUser {
  /** Stable user id derived from the configured auth strategy. */
  sub: string;
  [claim: string]: unknown;
}

// ─── Chat request / response ────────────────────────────────────────────────

export interface Message {
  role: string;
  content: string;
  tool_calls?: Array<ChatCompletionMessageToolCall>;
}

export interface ChatRequestBody {
  model: string;
  messages: ChatCompletionMessageParam[];
  stream: boolean;
  tools?: any;
  parallel_tool_calls?: boolean;
  user?: string;
  safety_identifier?: string;
}

export interface ChatCompletionsResponse {
  choices: ChatCompletion[];
}

export interface ChatCompletion {
  message: Message;
}

// ─── Model catalog / costs ──────────────────────────────────────────────────

export type LLMModel = string;
export type AIModel = LLMModel;

export type ModelVendor =
  | 'openai'
  | 'google'
  | 'anthropic'
  | 'meta'
  | 'deepseek'
  | 'unknown';

export type ModelEngine = 'openai' | 'gemini' | 'openrouter';

export interface ModelCost {
  _comment?: string;
  model: LLMModel;
  inputTokenValue: number; // usually 1
  outputTokenValue: number; // inputTokenValue * coefficient
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

// ─── Quota / usage schema ───────────────────────────────────────────────────

export enum Period {
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
}

export enum SubscriptionPlan {
  FREE = 'FREE',
  BASIC = 'BASIC',
  ADVANCED = 'ADVANCED',
}

export enum SystemMessageType {
  AUTHENTICATION_FAILED = 'AUTHENTICATION_FAILED',
  FORBIDDEN = 'FORBIDDEN',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',
  TOO_LONG_CONTEXT = 'TOO_LONG_CONTEXT',
}

export interface ApiRequestRecord {
  usage: number;
  timestamp: number;
}

export interface ApiUsage {
  userId: string;
  plan: SubscriptionPlan;
  bonusCredits: number;
  createdAt: string;
  lastRequestAt: string | null;
  periodSeconds: number;
  period: Period;
  periodStart: string;
  quota: number;
  updatedAt: string;
  usageCount: number;
  requests?: ApiRequestRecord[];
}
