import { NextFunction, Request, Response } from 'express';
import { config } from '../config';
import JwtAuthorizer from '../auth/jwt-authorizer';
import { AuthUser } from '../types';

const jwtAuthorizer = new JwtAuthorizer();

/**
 * Generic auth middleware.
 *
 * - `AUTH_MODE=none` (or `AUTH_DISABLED=true`): bypass verification and inject a
 *   stable synthetic user id so quota/logging keep working without credentials.
 * - `AUTH_MODE=jwt` (default): verify a Bearer JWT and resolve a user id.
 */
export const authorizer = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  if (config.auth.mode === 'none') {
    res.locals.user = { sub: config.auth.devUserId } as AuthUser;
    next();
    return;
  }

  try {
    const token = req.headers['authorization'];
    const userId = await jwtAuthorizer.authorize(token);
    if (!userId) {
      console.error('Unauthorized request');
      res.status(401).send({ error: 'Unauthorized request' });
      return;
    }
    res.locals.user = { sub: userId } as AuthUser;
    next();
  } catch (error: any) {
    console.error('Error authorizing request:', error);
    res.status(401).send({ error: 'Unauthorized request' });
  }
};
