import express from 'express';
import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from './config';
import { healthCheckRouter, servicesRouter } from './routes';
import { authorizer } from './middleware/auth';
import { requestLogger } from './middleware/request-logger';
import { setJsonContentType } from './middleware/json-content-type';
import { errorHandler } from './middleware/error-handler';

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const app = express();

// Number of proxy hops to trust for req.ip / X-Forwarded-For (env-controlled).
app.set('trust proxy', config.trustProxyHops);

app.use(express.json({ limit: config.jsonBodyLimit }));

// Health check router — before auth.
app.use(healthCheckRouter);

// Rate limiter middleware.
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: 'Too many requests from this IP, please try again later.',
});

app.use(limiter as unknown as RequestHandler);
app.use(authorizer);
app.use(requestLogger);
app.use(setJsonContentType);

// Chat router.
app.use(servicesRouter);

// Terminal error handler.
app.use(errorHandler);

export default app;
