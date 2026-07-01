import { Request, Response } from 'express';
import { chatValidateHandler } from './chat-controller';
import { quotaHandler } from './quota-handlers';
import { kChatCompletionsPath } from '../paths';

const makeRes = () => {
  const res: Partial<Response> = {
    status: jest.fn().mockReturnThis() as any,
    json: jest.fn() as any,
    locals: {
      user: { sub: 'test-user' },
      logger: { error: jest.fn(), log: jest.fn(), warn: jest.fn() },
    },
  };
  return res;
};

describe('chatValidateHandler', () => {
  it('rejects a request missing model/messages', () => {
    const req = { path: kChatCompletionsPath, body: {} } as Request;
    const res = makeRes();
    const next = jest.fn();
    chatValidateHandler(req, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('rejects an unknown model', () => {
    const req = { path: kChatCompletionsPath, body: { model: 'nope-not-real', messages: [] } } as Request;
    const res = makeRes();
    const next = jest.fn();
    chatValidateHandler(req, res as Response, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('accepts a known catalog model', () => {
    const req = {
      path: kChatCompletionsPath,
      body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
    } as Request;
    const res = makeRes();
    const next = jest.fn();
    chatValidateHandler(req, res as Response, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('accepts a configured proxy model', () => {
    const req = {
      path: kChatCompletionsPath,
      body: { model: 'gateway-fast', messages: [{ role: 'user', content: 'hi' }] },
    } as Request;
    const res = makeRes();
    const next = jest.fn();
    chatValidateHandler(req, res as Response, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('quotaHandler (in-memory store)', () => {
  it('provisions a default quota and calls next on first use', async () => {
    const req = {
      path: kChatCompletionsPath,
      body: { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
    } as Request;
    const res = makeRes();
    const next = jest.fn();
    await quotaHandler(req, res as Response, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalledWith(429);
  });
});
