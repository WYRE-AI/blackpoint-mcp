#!/usr/bin/env node

import { logger } from './utils/logger.js';
import { runStdioServer } from './server.js';
import { handleHttpRequest } from './http.js';
import { toWebRequest } from './http-request.js';
import {
  evaluateHttpStartup,
  resolveHttpBindHost,
  HTTP_S2S_MISSING_ERROR,
  HTTP_S2S_INSECURE_DEV_WARNING,
} from './http-startup.js';

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { value: error };
}

const transport = process.env.MCP_TRANSPORT || 'stdio';
const port = parseInt(process.env.MCP_HTTP_PORT || '8080', 10);

async function main(): Promise<void> {
  try {
    if (transport === 'http') {
      const startup = evaluateHttpStartup();
      if (!startup.allow) {
        logger.error(HTTP_S2S_MISSING_ERROR);
        process.exit(1);
      }
      if (startup.insecureDev) {
        // logger.warn is dropped when LOG_LEVEL=error. This line must stay visible.
        console.error(HTTP_S2S_INSECURE_DEV_WARNING);
      }

      const host = resolveHttpBindHost();
      const { createServer } = await import('http');

      logger.info('Starting HTTP server', { port, host });

      const server = createServer(async (req, res) => {
        try {
          const request = toWebRequest(req);

          const response = await handleHttpRequest(request);

          res.statusCode = response.status;
          response.headers.forEach((value, key) => {
            res.setHeader(key, value);
          });

          const body = await response.text();
          res.end(body);
        } catch (error) {
          logger.error('HTTP request handler error', { err: serializeError(error) });
          res.statusCode = 500;
          res.end('Internal Server Error');
        }
      });

      server.listen(port, host, () => {
        logger.info('Blackpoint MCP server listening on HTTP', {
          port,
          host,
          url: `http://${host}:${port}`,
        });
      });

      // Keep the server running
      await new Promise(() => {});
    } else {
      // Default to stdio transport
      await runStdioServer();
    }
  } catch (error) {
    logger.error('Failed to start server', { err: serializeError(error) });
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT, shutting down gracefully');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, shutting down gracefully');
  process.exit(0);
});

main().catch((error) => {
  logger.error('Unhandled error in main', { err: serializeError(error) });
  process.exit(1);
});