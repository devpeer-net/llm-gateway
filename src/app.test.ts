import request from 'supertest';
import app from './app';
import { generate } from './services/chat-service';

// Mock the LLM generation so the app test never hits a provider.
jest.mock('./services/chat-service', () => ({
  generate: jest.fn(),
  mapToOpenRouterModel: (m: string) => m,
}));

const mockGenerate = jest.mocked(generate);

beforeEach(() => {
  // resetMocks wipes implementations between tests, so (re)install it here.
  mockGenerate.mockImplementation(async (body: any) => ({
    id: 'chatcmpl-test',
    created: Math.floor(Date.now() / 1000),
    model: body.model,
    object: 'chat.completion',
    choices: [
      { index: 0, finish_reason: 'stop', logprobs: null, message: { role: 'assistant', content: 'Hi there!', refusal: null } },
    ],
    usage: { prompt_tokens: 7, completion_tokens: 3, total_tokens: 10 },
  }) as any);
});

describe('Health check', () => {
  it('GET / returns OK', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');
  });

  it('GET /health returns OK', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');
  });
});

describe('POST /v1/chat/completions (AUTH_MODE=none, memory store)', () => {
  it('returns a chat completion', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Content-Type', 'application/json')
      .send({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Hello!' }] });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('choices');
    expect(res.body.choices[0].message).toMatchObject({ role: 'assistant', content: 'Hi there!' });
  });

  it('rejects an invalid model with 400', async () => {
    const res = await request(app)
      .post('/v1/chat/completions')
      .set('Content-Type', 'application/json')
      .send({ model: 'not-a-real-model', messages: [{ role: 'user', content: 'Hello!' }] });

    expect(res.status).toBe(400);
  });
});

describe('AUTH_MODE=jwt', () => {
  const saved = { mode: process.env.AUTH_MODE, secret: process.env.AUTH_JWT_SECRET };

  afterAll(() => {
    process.env.AUTH_MODE = saved.mode;
    process.env.AUTH_JWT_SECRET = saved.secret;
  });

  it('returns 401 without a token', async () => {
    let freshApp: any;
    jest.isolateModules(() => {
      process.env.AUTH_MODE = 'jwt';
      process.env.AUTH_JWT_SECRET = 'test-secret';
      freshApp = require('./app').default;
    });

    const res = await request(freshApp)
      .post('/v1/chat/completions')
      .set('Content-Type', 'application/json')
      .send({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'Hello!' }] });

    expect(res.status).toBe(401);
  });
});

describe('trust proxy is env-driven', () => {
  it('applies TRUST_PROXY_HOPS to the express app', () => {
    let freshApp: any;
    const savedHops = process.env.TRUST_PROXY_HOPS;
    jest.isolateModules(() => {
      process.env.TRUST_PROXY_HOPS = '2';
      freshApp = require('./app').default;
    });
    process.env.TRUST_PROXY_HOPS = savedHops;
    expect(freshApp.get('trust proxy')).toBe(2);
  });
});
