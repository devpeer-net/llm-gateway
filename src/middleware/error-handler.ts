import { NextFunction, Request, Response } from 'express';
import { HttpApiError } from '../types';

/** Terminal error handler: maps HttpApiError → status code, otherwise 500. */
export const errorHandler = (error: any, req: Request, res: Response, next: NextFunction): void => {
  res.locals.logger?.error('Error:', error.message);
  if (res.headersSent) {
    return;
  }

  if (error instanceof HttpApiError) {
    res.status(error.statusCode).send({ error: error.message });
    return;
  }
  res.status(500).send({ error: 'Internal server error' });
};
