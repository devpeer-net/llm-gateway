import app from './src/app';
import { config, assertSecureConfig } from './src/config';

// Fail fast on an insecure production configuration (e.g. no-auth in prod).
try {
  assertSecureConfig();
} catch (error) {
  console.error(`FATAL: ${(error as Error).message}`);
  process.exit(1);
}

const port = config.port;

const server = app.listen(port, () => {
  console.log(`llm-gateway listening on port ${port}`);
});

// Configure HTTP server timeouts to support long-running streaming responses.
const TIMEOUT_MS = config.requestTimeoutMs;
server.timeout = TIMEOUT_MS; // Overall server timeout
server.keepAliveTimeout = TIMEOUT_MS; // Keep-alive timeout
server.headersTimeout = TIMEOUT_MS + 1000; // Slightly higher than keepAliveTimeout
server.requestTimeout = TIMEOUT_MS; // Request timeout

console.log(`Server timeouts configured: ${TIMEOUT_MS}ms (${TIMEOUT_MS / 1000}s)`);
