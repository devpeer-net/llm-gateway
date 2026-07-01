import { NextFunction, Request, Response } from 'express';

/** Per-request logger prefixing `timestamp [userId]`, wrapping console. */
export const requestLogger = (req: Request, res: Response, next: NextFunction): void => {
  const createLogger = (userId?: string) => ({
    log: (message?: any, ...optionalParams: any[]) => {
      console.log(`${new Date().toISOString()} [${userId}] ${message}`, ...optionalParams);
    },
    error: (message?: any, ...optionalParams: any[]) => {
      console.error(`${new Date().toISOString()} [${userId}] ${message}`, ...optionalParams);
    },
    warn: (message?: any, ...optionalParams: any[]) => {
      console.warn(`${new Date().toISOString()} [${userId}] ${message}`, ...optionalParams);
    },
  });

  res.locals.logger = createLogger(res.locals.user?.sub);
  res.locals.logger.log(`${req.method} ${req.path}`);
  next();
};
