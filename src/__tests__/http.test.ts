import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHmac } from 'node:crypto';

/**
 * Integration coverage for the S2S wiring point in handleHttpRequest()
 * (gateway#377 parity, PR#54). Pure verifyS2sHeader() logic is already
 * covered by s2s-verify.test.ts; this file covers the integration surface
 * warden's #54 review found untested: the Fetch-API header read
 * (`req.headers.get() ?? undefined`), the S2S-check-before-credential-check
 * ordering, and the dark-by-default skip when CONDUIT_S2S_SECRET is unset.
 * Scripted from the PR's own 4-case manual smoke test so a future refactor
 * can't silently break the wiring.
 *
 * S2S_SECRET is read once at module load in src/http.ts, so each describe
 * block below sets the env var it needs BEFORE a fresh dynamic import.
 */

function mintHeader(secret: string, unixSeconds: number): string {
  const message = `t=${unixSeconds}`;
  const hex = createHmac('sha256', secret).update(message).digest('hex');
  return `${message},v1=${hex}`;
}

const BLACKPOINT_SUBKEY = 'blackpoint-derived-subkey-test';
const SIBLING_SUBKEY = 'abnormal-derived-subkey-test';

describe('handleHttpRequest — S2S wiring integration', () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...origEnv };
  });

  describe('S2S enforcement enabled (CONDUIT_S2S_SECRET set)', () => {
    beforeEach(() => {
      vi.resetModules();
      process.env.CONDUIT_S2S_SECRET = BLACKPOINT_SUBKEY;
      delete process.env.AUTH_MODE;
    });

    it('rejects a request with no X-Gateway-S2S header (401, S2S rejection body) — smoke-test case 1', async () => {
      const { handleHttpRequest } = await import('../http.js');
      const req = new Request('http://localhost/mcp', { method: 'POST' });
      const res = await handleHttpRequest(req);

      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/Missing or invalid X-Gateway-S2S header/);
    });

    it("rejects a header minted with a different vendor's derived subkey (401, identical rejection body — recipient-binding) — smoke-test case 2", async () => {
      const { handleHttpRequest } = await import('../http.js');
      const now = Math.floor(Date.now() / 1000);
      const req = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'x-gateway-s2s': mintHeader(SIBLING_SUBKEY, now) },
      });
      const res = await handleHttpRequest(req);

      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: string };
      expect(body.error).toMatch(/Missing or invalid X-Gateway-S2S header/);
    });

    it("accepts a header minted with this vendor's own derived subkey and falls through to the next auth layer (distinct 401 body proves the header was read/verified, not silently swallowed) — smoke-test case 3", async () => {
      process.env.AUTH_MODE = 'gateway';
      const { handleHttpRequest } = await import('../http.js');
      const now = Math.floor(Date.now() / 1000);
      const req = new Request('http://localhost/mcp', {
        method: 'POST',
        headers: { 'x-gateway-s2s': mintHeader(BLACKPOINT_SUBKEY, now) },
      });
      const res = await handleHttpRequest(req);

      // S2S passed; control fell through to the pre-existing gateway-credential
      // check, which has a DISTINCT body shape from the S2S rejection above.
      expect(res.status).toBe(401);
      const body = (await res.json()) as {
        jsonrpc: string;
        error: { code: number; message: string };
      };
      expect(body.jsonrpc).toBe('2.0');
      expect(body.error.code).toBe(-32001);
      expect(body.error.message).toMatch(/missing required gateway credential header/);
    });

    it('/health bypasses S2S entirely regardless of header — smoke-test case 4', async () => {
      const { handleHttpRequest } = await import('../http.js');
      const req = new Request('http://localhost/health', { method: 'GET' });
      const res = await handleHttpRequest(req);

      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string };
      expect(body.status).toBe('ok');
    });
  });

  describe('S2S enforcement disabled (CONDUIT_S2S_SECRET unset — dark-by-default)', () => {
    beforeEach(() => {
      vi.resetModules();
      delete process.env.CONDUIT_S2S_SECRET;
      process.env.AUTH_MODE = 'gateway';
    });

    it('skips the S2S check entirely when the secret is empty, falling straight through to the next auth layer even with no header at all', async () => {
      const { handleHttpRequest } = await import('../http.js');
      const req = new Request('http://localhost/mcp', { method: 'POST' });
      const res = await handleHttpRequest(req);

      // No S2S rejection — reaches the gateway-credential check directly,
      // proving the empty-secret guard in http.ts actually short-circuits
      // the verifyS2sHeader() call rather than calling it with an empty
      // secret and relying on verifyS2sHeader's own "always false" guard.
      expect(res.status).toBe(401);
      const body = (await res.json()) as {
        jsonrpc: string;
        error: { code: number; message: string };
      };
      expect(body.jsonrpc).toBe('2.0');
      expect(body.error.code).toBe(-32001);
      expect(body.error.message).toMatch(/missing required gateway credential header/);
    });
  });
});

/**
 * Regression coverage for the request-scoping bug in the gateway-credential
 * branch: baseUrl must come from the x-blackpoint-base-url REQUEST HEADER
 * (per-request, matching apiToken's own scoping), never from
 * process.env.BLACKPOINT_BASE_URL (the container's own environment) — a
 * customer's configured base URL was previously silently dropped in favor
 * of whatever (or nothing) was baked into the container's env, with no
 * error anywhere in the request path.
 */
describe('handleHttpRequest — gateway-mode baseUrl scoping', () => {
  const origEnv = { ...process.env };
  let capturedContext: { apiToken: string; baseUrl?: string } | undefined;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...origEnv };
    delete process.env.CONDUIT_S2S_SECRET;
    process.env.AUTH_MODE = 'gateway';
    capturedContext = undefined;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    vi.doUnmock('../utils/request-context.js');
  });

  it('uses the x-blackpoint-base-url header, not process.env.BLACKPOINT_BASE_URL, when both are set to different values', async () => {
    process.env.BLACKPOINT_BASE_URL = 'https://env-baked-in.example.com';

    vi.doMock('../utils/request-context.js', async () => {
      const actual = await vi.importActual<typeof import('../utils/request-context.js')>(
        '../utils/request-context.js'
      );
      return {
        ...actual,
        requestContext: {
          run: vi.fn((ctx: { apiToken: string; baseUrl?: string }) => {
            capturedContext = ctx;
            return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
          }),
        },
      };
    });

    const { handleHttpRequest } = await import('../http.js');
    const req = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'x-blackpoint-api-token': 'test-token',
        'x-blackpoint-base-url': 'https://customer-instance.blackpointcyber.com',
      },
    });
    await handleHttpRequest(req);

    expect(capturedContext).toBeDefined();
    expect(capturedContext?.baseUrl).toBe('https://customer-instance.blackpointcyber.com');
    expect(capturedContext?.baseUrl).not.toBe('https://env-baked-in.example.com');
  });

  it('omits baseUrl entirely when the header is absent, even if process.env.BLACKPOINT_BASE_URL is set (no env fallback)', async () => {
    process.env.BLACKPOINT_BASE_URL = 'https://env-baked-in.example.com';

    vi.doMock('../utils/request-context.js', async () => {
      const actual = await vi.importActual<typeof import('../utils/request-context.js')>(
        '../utils/request-context.js'
      );
      return {
        ...actual,
        requestContext: {
          run: vi.fn((ctx: { apiToken: string; baseUrl?: string }) => {
            capturedContext = ctx;
            return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
          }),
        },
      };
    });

    const { handleHttpRequest } = await import('../http.js');
    const req = new Request('http://localhost/mcp', {
      method: 'POST',
      headers: { 'x-blackpoint-api-token': 'test-token' },
    });
    await handleHttpRequest(req);

    expect(capturedContext).toBeDefined();
    expect(capturedContext?.baseUrl).toBeUndefined();
  });
});
