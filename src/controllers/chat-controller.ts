import { Request, Response } from 'express';
import { generate } from '../services/chat-service';
import { isKnownModel } from '../llm/model-catalog';
import { isProxyModel } from '../services/proxy-model-resolver';
import { HttpApiError } from '../types';
import { ChatCompletion } from 'openai/resources';
import { quotaHandler, updateChatQuotaHandler } from './quota-handlers';

export const chatValidateHandler = (req: Request, res: Response, next: any) => {
  if (!req.body) {
    res.status(400).json({ error: 'Missing request body' });
    return;
  }

  if (!req.body.model || !req.body.messages) {
    res.status(400).json({ error: 'Missing required fields: model, messages' });
    return;
  }

  if (typeof req.body.model !== 'string') {
    res.status(400).json({ error: 'model must be a string' });
    return;
  }

  const isValidModel = isKnownModel(req.body.model) || isProxyModel(req.body.model);
  if (!isValidModel) {
    res.status(400).json({ error: 'Invalid model value' });
    return;
  }

  if (!Array.isArray(req.body.messages)) {
    res.status(400).json({ error: 'messages must be an array' });
    return;
  }

  if (req.body.stream && typeof req.body.stream !== 'boolean') {
    res.status(400).json({ error: 'stream must be a boolean' });
    return;
  }

  next();
};

export const generateHandler = async (req: Request, res: Response, next: any) => {
  if (req.body.stream) {
    next();
    return;
  }

  try {
    const generateResponse: ChatCompletion = await generate(req.body, res.locals.apiUsage);
    res.locals.generateResponse = generateResponse;
    res.status(200).json(generateResponse);
    next();
  } catch (error: any) {
    res.locals.logger.error('Error generating content:', error);
    if (error instanceof HttpApiError) {
      res.status(error.statusCode).json({ error: error.message });
    } else {
      res.status(500).json({ error: 'Error generating content' });
    }
  }
};

export const generateStreamHandler = async (req: Request, res: Response, next: any) => {
  if (!req.body.stream) {
    next();
    return;
  }

  try {
    let keepGenerating = true;
    res.on('close', () => {
      console.log('Client closed connection');
      keepGenerating = false;
    });

    const genRes: ChatCompletion = await generate(req.body, res.locals.apiUsage, (delta: string): boolean => {
      if (!res.headersSent) {
        // Establish SSE with the client.
        res.set({
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive',
        });
        res.flushHeaders();
      }
      res.write(delta);
      return keepGenerating;
    });
    res.locals.generateResponse = genRes;
    res.end(JSON.stringify(genRes));
    next();
  } catch (error: any) {
    res.locals.logger.error('Error generating content', error);
    if (!res.headersSent) {
      if (error instanceof HttpApiError) {
        res.status(error.statusCode).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Error generating content' });
      }
    } else {
      if (error instanceof HttpApiError && error.statusCode === 403) {
        res.write(
          "I'm sorry, I cannot continue this conversation. My response was flagged as potentially harmful. If you believe this is an error, please try rephrasing your request."
        );
      } else {
        res.write("I'm sorry, I encountered an error while generating content. Please try again later.");
      }
      res.end();
    }
  }
};

export const chatCompletion = [chatValidateHandler, quotaHandler, generateHandler, generateStreamHandler, updateChatQuotaHandler];
