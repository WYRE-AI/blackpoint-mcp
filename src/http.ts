import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createMcpServer } from './server.js';
import { logger } from './utils/logger.js';
import { requestContext, freshNavigationState } from './utils/request-context.js';
import { verifyS2sHeader, S2S_HEADER } from './s2s-verify.js';
import { normalizeBlackpointBaseUrl } from './utils/base-url.js';

// Conduit service-to-service auth (gateway#377 parity). Non-empty =
// enforce X-Gateway-S2S on every authenticated route. An empty secret
// skips the check here so MCP_ALLOW_INSECURE_DEV=1 can still serve local
// traffic; process startup refuses to listen in that case unless the dev
// flag is set (src/http-startup.ts). See src/s2s-verify.ts.
const S2S_SECRET = process.env.CONDUIT_S2S_SECRET || '';

function isUnauthenticatedHealth(req: Request, pathname: string): boolean {
  // Liveness probes must not read credential headers or process.env secrets.
  if (pathname === '/health' || pathname === '/healthz') return true;
  // The image HEALTHCHECK is `GET /`. Other methods on `/` stay on the MCP route.
  return pathname === '/' && (req.method === 'GET' || req.method === 'HEAD');
}

export async function handleHttpRequest(req: Request): Promise<Response> {
  // Unauthenticated shallow health check for the Azure liveness probe and
  // the image HEALTHCHECK. Returns before S2S or vendor-credential reads.
  const { pathname } = new URL(req.url);
  if (isUnauthenticatedHealth(req, pathname)) {
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

    // Same request-scoping rule as apiToken above: a customer-configured
    // base URL arrives per-request via the x-blackpoint-base-url header
    // (Conduit's headerMapping sends it there). Falling back to the
    // process environment here would silently drop any customer's
    // non-default Blackpoint instance and route every tool call at
    // whatever (or nothing) is baked into this container's own env.
    // Normalize before the request context is stored. The live host (with or
    // without /v1) and the legacy api.compassone.blackpointcyber.com host
    // become https://api.blackpointcyber.com/v1. Any other host keeps its
    // origin and gains a single /v1 suffix. An absent header stays absent so
    // this process's BLACKPOINT_BASE_URL cannot override a customer.
    const rawBaseUrl = req.headers.get('x-blackpoint-base-url');
    const baseUrl = rawBaseUrl ? normalizeBlackpointBaseUrl(rawBaseUrl) : undefined;
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
