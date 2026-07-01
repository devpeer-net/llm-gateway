import { Router } from 'express';
import { chatCompletion } from './controllers/chat-controller';
import { kChatCompletionsPath } from './paths';

export const healthCheckRouter = Router();

healthCheckRouter.get(['/', '/health'], (req, res) => {
  res.send('OK');
});

export const servicesRouter = Router();

servicesRouter.post(kChatCompletionsPath, chatCompletion);
