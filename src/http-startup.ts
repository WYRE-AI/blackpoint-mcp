/**
 * HTTP startup policy for service-to-service auth.
 *
 * An empty CONDUIT_S2S_SECRET used to leave /mcp open: the request handler
 * only checks X-Gateway-S2S when the secret is non-empty. Startup now
 * refuses to listen in that case. MCP_ALLOW_INSECURE_DEV=1 is the only
 * bypass, and it is local-development only.
 *
 * These messages are static. Never interpolate the secret into them.
 */

export const HTTP_S2S_MISSING_ERROR =
  'Refusing to start HTTP server: CONDUIT_S2S_SECRET is empty. Set CONDUIT_S2S_SECRET so /mcp requires a valid X-Gateway-S2S header, or set MCP_ALLOW_INSECURE_DEV=1 for local development only.';

export const HTTP_S2S_INSECURE_DEV_WARNING =
  'WARNING: CONDUIT_S2S_SECRET is empty. MCP_ALLOW_INSECURE_DEV=1 is set, so the HTTP server is starting WITHOUT service-to-service authentication. Do not use this outside local development.';

export type HttpStartupDecision =
  | { allow: true; insecureDev: false }
  | { allow: true; insecureDev: true }
  | { allow: false };

export function evaluateHttpStartup(env: NodeJS.ProcessEnv = process.env): HttpStartupDecision {
  if (env.CONDUIT_S2S_SECRET) {
    return { allow: true, insecureDev: false };
  }
  if (env.MCP_ALLOW_INSECURE_DEV === '1') {
    return { allow: true, insecureDev: true };
  }
  return { allow: false };
}

/** Bind address for the HTTP server. Unset or empty stays on loopback. */
export function resolveHttpBindHost(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.MCP_HTTP_HOST;
  if (configured === undefined || configured === '') {
    return '127.0.0.1';
  }
  return configured;
}
