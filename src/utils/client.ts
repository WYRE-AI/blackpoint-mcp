import { CompassOneClient, type CompassOneConfig } from '@wyre-ai/node-blackpoint';
import { normalizeBlackpointBaseUrl } from './base-url.js';
import { logger } from './logger.js';
import { getRequestContext } from './request-context.js';

// Per-request CompassOne client.
//
// In HTTP/gateway mode, credentials come from AsyncLocalStorage's
// per-request `RequestContext` — every request's handler chain sees only
// its own apiToken / baseUrl. There is intentionally NO module-level
// client or credential cache: tenants share this process, and a shared
// instance with mutable state would let one tenant's handler observe
// another tenant's client mid-request.
//
// In stdio mode there is no per-request context, so credentials fall
// back to environment variables (stdio is single-tenant by design).
export async function getClient(): Promise<CompassOneClient> {
  const ctx = getRequestContext();
  if (ctx) {
    const config: CompassOneConfig = { apiToken: ctx.apiToken };
    // Gateway mode must not fall through to process.env. A header value is
    // normalized (legacy CompassOne host, missing or extra /v1). Omitting
    // the header leaves baseUrl unset so the SDK uses the live default.
    if (ctx.baseUrl) config.baseUrl = normalizeBlackpointBaseUrl(ctx.baseUrl);
    logger.debug('Creating per-request CompassOne client (gateway mode)');
    return new CompassOneClient(config);
  }

  const apiToken = process.env.BLACKPOINT_API_TOKEN;
  if (!apiToken) {
    throw new Error(
      'No CompassOne API credentials configured. Set BLACKPOINT_API_TOKEN environment variable, or run behind the gateway with the x-blackpoint-api-token header.'
    );
  }

  const config: CompassOneConfig = {
    apiToken,
    baseUrl: normalizeBlackpointBaseUrl(process.env.BLACKPOINT_BASE_URL),
  };

  logger.debug('Creating CompassOne client from environment (stdio mode)');
  return new CompassOneClient(config);
}
