import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from './server.js';
import { logger } from './utils/logger.js';
import { requestContext, freshNavigationState } from './utils/request-context.js';
import { verifyS2sHeader, S2S_HEADER } from './s2s-verify.js';

// Conduit service-to-service auth (gateway#377 parity). Non-empty =
// enforce X-Gateway-S2S on every /mcp request; empty = disabled, behavior
// exactly as before (dark-by-default until the gateway provisions this
// container's derived subkey). See src/s2s-verify.ts.
const S2S_SECRET = process.env.CONDUIT_S2S_SECRET || '';

export async function handleHttpRequest(req: Request): Promise<Response> {
  // Unauthenticated shallow health check for the Azure liveness probe.
  const { pathname } = new URL(req.url);
  if (pathname === '/health' || pathname === '/healthz') {
    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Conduit service-to-service auth (gateway#377 parity): rejected
  // BEFORE any credential extraction, mirroring every other ported
  // wrapper (e.g. containers/sentinelone-mcp/gateway_wrapper.py). This
  // repo uses a Fetch API Request, so the header read differs from the
  // Node-http-style repos: request.headers.get() returns string | null.
  if (S2S_SECRET && !verifyS2sHeader(req.headers.get(S2S_HEADER) ?? undefined, S2S_SECRET)) {
    return new Response(
      JSON.stringify({
        error:
          'Missing or invalid X-Gateway-S2S header: this endpoint only accepts requests signed by the gateway.',
      }),
      { status: 401, headers: { 'Content-Type': 'application/json' } }
    );
  }

  // Gateway mode: credentials must arrive on every request via the
  // x-blackpoint-api-token header. Reject explicitly if missing rather
  // than falling through — falling through would resolve credentials
  // from the process environment, which is not request-scoped.
  if (process.env.AUTH_MODE === 'gateway') {
    const apiToken = req.headers.get('x-blackpoint-api-token');
    if (!apiToken) {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32001,
            message:
              'Unauthorized: missing required gateway credential header x-blackpoint-api-token',
          },
          id: null,
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    const baseUrl = process.env.BLACKPOINT_BASE_URL;
    return requestContext.run(
      {
        apiToken,
        ...(baseUrl ? { baseUrl } : {}),
        server: null,
        navigationState: freshNavigationState(),
      },
      () => runMcpRequest(req)
    );
  }

  // Stdio / env mode: credentials resolve from process.env directly,
  // no per-request context required (single-tenant by design).
  return runMcpRequest(req);
}

async function runMcpRequest(req: Request): Promise<Response> {
  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(req);
  } catch (error) {
    logger.error('MCP HTTP transport error', error);

    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        error: { code: -32603, message: 'Internal error' },
        id: null,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } finally {
    transport.close();
    server.close();
  }
}
