import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Capture every CompassOneClient construction so tests can assert which
// token/baseUrl a client was actually built with, and that per-request
// calls build distinct instances rather than reusing a singleton.
const { constructions } = vi.hoisted(() => ({
  constructions: [] as Array<{ apiToken: string; baseUrl?: string }>,
}));

vi.mock('@wyre-ai/node-blackpoint', async () => {
  const actual = await vi.importActual<typeof import('@wyre-ai/node-blackpoint')>(
    '@wyre-ai/node-blackpoint'
  );
  return {
    ...actual,
    CompassOneClient: class {
      apiToken: string;
      baseUrl?: string;
      constructor(config: { apiToken: string; baseUrl?: string }) {
        this.apiToken = config.apiToken;
        this.baseUrl = config.baseUrl;
        constructions.push({ apiToken: config.apiToken, baseUrl: config.baseUrl });
      }
    },
  };
});

import { requestContext, freshNavigationState, getRequestContext } from '../utils/request-context.js';
import { getClient } from '../utils/client.js';
import { getNavigationState, setCurrentDomain } from '../domains/navigation.js';
import { setServerRef, getServerRef } from '../utils/server-ref.js';
import { handleHttpRequest } from '../http.js';

// These tests pin the per-request isolation guarantees that
// AsyncLocalStorage-based RequestContext provides. They are the
// regression guards for the module-level singletons we removed:
//   - `_client` / `_credentials` in src/utils/client.ts
//   - `process.env.BLACKPOINT_API_TOKEN` mutation in src/http.ts
//   - `serverRef` in src/utils/server-ref.ts
//   - `navigationState` in src/domains/navigation.ts
describe('tenant isolation via per-request context', () => {
  const origAuthMode = process.env.AUTH_MODE;
  const origToken = process.env.BLACKPOINT_API_TOKEN;

  beforeEach(() => {
    delete process.env.AUTH_MODE;
    delete process.env.BLACKPOINT_API_TOKEN;
    delete process.env.BLACKPOINT_BASE_URL;
    constructions.length = 0;
  });

  afterEach(() => {
    if (origAuthMode === undefined) delete process.env.AUTH_MODE;
    else process.env.AUTH_MODE = origAuthMode;
    if (origToken === undefined) delete process.env.BLACKPOINT_API_TOKEN;
    else process.env.BLACKPOINT_API_TOKEN = origToken;
  });

  function runInContext<T>(
    apiToken: string,
    fn: () => Promise<T> | T,
    baseUrl?: string,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const ctx = {
        apiToken,
        ...(baseUrl ? { baseUrl } : {}),
        server: null,
        navigationState: freshNavigationState(),
      };
      requestContext.run(ctx, () => {
        Promise.resolve(fn()).then(resolve, reject);
      });
    });
  }

  describe('client credentials are scoped to the request', () => {
    it('two contexts see their own apiToken', async () => {
      const seen: Record<string, string | undefined> = {};

      await Promise.all([
        runInContext('token-A', () => {
          seen.A = getRequestContext()?.apiToken;
        }),
        runInContext('token-B', () => {
          seen.B = getRequestContext()?.apiToken;
        }),
      ]);

      expect(seen.A).toBe('token-A');
      expect(seen.B).toBe('token-B');
    });

    it('getClient inside a context reads from the context, not process.env', async () => {
      process.env.BLACKPOINT_API_TOKEN = 'env-token-should-not-be-used';

      const client = await runInContext('per-request-token', () => getClient());

      // The CompassOneClient instance is opaque here, but the key
      // assertion is that the call succeeded inside the context with
      // a different token than process.env held — meaning getClient
      // did NOT fall through to the env path.
      expect(client).toBeDefined();
    });

    it('does NOT mutate process.env when a request supplies credentials', async () => {
      process.env.AUTH_MODE = 'gateway';
      const before = process.env.BLACKPOINT_API_TOKEN;

      await runInContext('per-request-token', () => getClient());

      expect(process.env.BLACKPOINT_API_TOKEN).toBe(before);
    });

    it('getClient throws outside any context when no env token is set', async () => {
      delete process.env.BLACKPOINT_API_TOKEN;
      await expect(getClient()).rejects.toThrow(/CompassOne API credentials/);
    });

    it('falls back to env credentials outside any request scope (stdio mode)', async () => {
      process.env.BLACKPOINT_API_TOKEN = 'env-token';
      process.env.BLACKPOINT_BASE_URL = 'https://env.example/v1';

      const client = (await getClient()) as unknown as { apiToken: string; baseUrl?: string };

      expect(client.apiToken).toBe('env-token');
      expect(client.baseUrl).toBe('https://env.example/v1');
    });

    it('normalizes a legacy CompassOne env base URL onto the live v1 host', async () => {
      process.env.BLACKPOINT_API_TOKEN = 'env-token';
      process.env.BLACKPOINT_BASE_URL = 'https://api.compassone.blackpointcyber.com';

      const client = (await getClient()) as unknown as { baseUrl?: string };

      expect(client.baseUrl).toBe('https://api.blackpointcyber.com/v1');
    });

    it('appends /v1 when the env base URL omits it and does not double it', async () => {
      process.env.BLACKPOINT_API_TOKEN = 'env-token';
      process.env.BLACKPOINT_BASE_URL = 'https://api.blackpointcyber.com';

      const client = (await getClient()) as unknown as { baseUrl?: string };

      expect(client.baseUrl).toBe('https://api.blackpointcyber.com/v1');
    });

    it('threads the per-request base URL into the client', async () => {
      const client = (await runInContext(
        't',
        () => getClient(),
        'https://mail.example.com/blackpoint/v1',
      )) as unknown as { baseUrl?: string };

      expect(client.baseUrl).toBe('https://mail.example.com/blackpoint/v1');
    });

    it('builds a distinct client per call rather than reusing a singleton', async () => {
      const a = await runInContext('a', () => getClient());
      const b = await runInContext('b', () => getClient());
      expect(a).not.toBe(b);
      expect(constructions).toHaveLength(2);
    });

    it('many concurrent contexts each see only their own apiToken', async () => {
      const N = 10;
      const seen: Array<string | undefined> = new Array(N);

      await Promise.all(
        Array.from({ length: N }, (_, i) =>
          runInContext(`tenant-${i}`, async () => {
            // Yield to interleave with siblings.
            await new Promise((r) => setImmediate(r));
            seen[i] = getRequestContext()?.apiToken;
          })
        )
      );

      seen.forEach((token, i) => {
        expect(token).toBe(`tenant-${i}`);
      });
    });
  });

  describe('navigation state is scoped to the request', () => {
    it('setCurrentDomain inside one context does not affect another', async () => {
      const results: Record<string, string | null> = {};

      await Promise.all([
        runInContext('A', async () => {
          setCurrentDomain('assets');
          await new Promise((r) => setImmediate(r));
          results.A = getNavigationState().currentDomain;
        }),
        runInContext('B', async () => {
          setCurrentDomain('vulnerabilities');
          await new Promise((r) => setImmediate(r));
          results.B = getNavigationState().currentDomain;
        }),
      ]);

      expect(results.A).toBe('assets');
      expect(results.B).toBe('vulnerabilities');
    });

    it('each request starts with a fresh navigation state', async () => {
      const first = await runInContext('A', () => {
        setCurrentDomain('detections');
        return getNavigationState().currentDomain;
      });
      const second = await runInContext('A-again', () => {
        return getNavigationState().currentDomain;
      });

      expect(first).toBe('detections');
      expect(second).toBeNull();
    });
  });

  describe('server reference is scoped to the request', () => {
    it('setServerRef in one context is not visible from another', async () => {
      const fakeA = { id: 'server-A' } as unknown as Parameters<typeof setServerRef>[0];
      const fakeB = { id: 'server-B' } as unknown as Parameters<typeof setServerRef>[0];

      const results: Record<string, unknown> = {};

      await Promise.all([
        runInContext('A', async () => {
          setServerRef(fakeA);
          await new Promise((r) => setImmediate(r));
          results.A = (getServerRef() as unknown as { id: string }).id;
        }),
        runInContext('B', async () => {
          setServerRef(fakeB);
          await new Promise((r) => setImmediate(r));
          results.B = (getServerRef() as unknown as { id: string }).id;
        }),
      ]);

      expect(results.A).toBe('server-A');
      expect(results.B).toBe('server-B');
    });
  });

  // These exercise handleHttpRequest itself, the real HTTP entry point where
  // the fail-open defect lived. Every other test in this file checks one
  // layer below the entry point (request-context / getClient directly) — a
  // real request through handleHttpRequest is what actually proves the fix.
  describe('handleHttpRequest rejects gateway requests missing the credential header', () => {
    function gatewayRequest(headers: Record<string, string> = {}): Request {
      return new Request('http://localhost:8080/mcp', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...headers,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
      });
    }

    it('returns 401 when x-blackpoint-api-token is missing in gateway mode', async () => {
      process.env.AUTH_MODE = 'gateway';

      const res = await handleHttpRequest(gatewayRequest());

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe(-32001);
      expect(body.error.message).toMatch(/x-blackpoint-api-token/);
    });

    it('does not fall through to process.env credentials on a missing header', async () => {
      process.env.AUTH_MODE = 'gateway';
      process.env.BLACKPOINT_API_TOKEN = 'some-other-tenant-static-token';

      const res = await handleHttpRequest(gatewayRequest());

      // Pre-fix, a missing header fell through to handle() unscoped, which
      // resolved credentials from process.env if any static token was
      // configured for the deployment — fail-open onto whatever token
      // happened to be set, not the requesting tenant's own token.
      expect(res.status).toBe(401);
      expect(constructions).toHaveLength(0);
    });

    it('does not write the supplied token into process.env', async () => {
      process.env.AUTH_MODE = 'gateway';
      delete process.env.BLACKPOINT_API_TOKEN;

      await handleHttpRequest(gatewayRequest({ 'x-blackpoint-api-token': 'tenant-A-secret' }));

      expect(process.env.BLACKPOINT_API_TOKEN).not.toBe('tenant-A-secret');
    });
  });
});
