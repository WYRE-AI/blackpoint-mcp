import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { assetsHandler } from '../domains/assets.js';
import { detectionsHandler } from '../domains/detections.js';
import { freshNavigationState, requestContext } from '../utils/request-context.js';
import { logger } from '../utils/logger.js';

const LIVE = 'https://api.blackpointcyber.com';
const TOKEN = 'msp-live-api-token';

interface SeenRequest {
  url: string;
  tenantId: string | null;
  authorization: string | null;
}

const seen: SeenRequest[] = [];

function record(request: Request): void {
  seen.push({
    url: request.url,
    tenantId: request.headers.get('x-tenant-id'),
    authorization: request.headers.get('authorization'),
  });
}

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
  server.resetHandlers();
  seen.length = 0;
});

afterAll(() => {
  server.close();
});

function assetPage() {
  return HttpResponse.json({
    data: [
      {
        id: 'asset-1',
        accountId: 'acct',
        tenantId: 'tenant-1',
        assetClass: 'DEVICE',
        displayName: 'laptop',
        name: 'laptop',
        status: 'active',
      },
    ],
    meta: { currentPage: 1, totalItems: 1, pageSize: 50, totalPages: 1 },
  });
}

describe('live CompassOne calls (msw)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AUTH_MODE;
    process.env.BLACKPOINT_API_TOKEN = TOKEN;
    delete process.env.BLACKPOINT_BASE_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('lists assets on the live v1 host with x-tenant-id and reads pagination from meta', async () => {
    server.use(
      http.get(`${LIVE}/v1/assets`, ({ request }) => {
        record(request);
        return assetPage();
      })
    );

    const result = await assetsHandler.handleCall('blackpoint_assets_list', {
      class: 'DEVICE',
      tenantId: 'tenant-1',
    });

    expect(result.isError).toBeFalsy();
    expect((result.content[0] as { text: string }).text).toMatch(/Found 1 DEVICE assets \(Page 1 of 1\)/);
    expect(seen).toHaveLength(1);
    const url = new URL(seen[0]!.url);
    expect(url.origin).toBe(LIVE);
    expect(url.pathname).toBe('/v1/assets');
    expect(url.searchParams.get('class')).toBe('DEVICE');
    expect(url.searchParams.has('tenantId')).toBe(false);
    expect(seen[0]!.tenantId).toBe('tenant-1');
    expect(seen[0]!.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it.each([
    undefined,
    'https://api.blackpointcyber.com',
    'https://api.blackpointcyber.com/v1',
    'https://api.blackpointcyber.com/v1/',
    'https://api.compassone.blackpointcyber.com',
    'https://api.compassone.blackpointcyber.com/v1',
    'https://api.compassone.blackpointcyber.com/',
  ])('normalizes base URL %s onto the live v1 host', async baseUrl => {
    if (baseUrl) process.env.BLACKPOINT_BASE_URL = baseUrl;
    server.use(
      http.get(`${LIVE}/v1/assets/:id`, ({ request }) => {
        record(request);
        return HttpResponse.json({
          id: 'asset-1',
          accountId: 'acct',
          tenantId: 'tenant-1',
          assetClass: 'DEVICE',
          displayName: 'laptop',
          name: 'laptop',
          status: 'active',
        });
      })
    );

    const result = await assetsHandler.handleCall('blackpoint_assets_get', {
      id: 'asset-1',
      tenantId: 'tenant-1',
    });

    expect(result.isError).toBeFalsy();
    const url = new URL(seen[0]!.url);
    expect(url.href).toBe(`${LIVE}/v1/assets/asset-1`);
    expect(seen[0]!.tenantId).toBe('tenant-1');
    expect(url.hostname).not.toContain('compassone');
  });

  it('sends relationship direction and entityClass with x-tenant-id', async () => {
    server.use(
      http.get(`${LIVE}/v1/assets/:id/relationships`, ({ request }) => {
        record(request);
        return HttpResponse.json({
          data: [
            {
              id: 'rel-1',
              sourceAssetId: 'asset-1',
              targetAssetId: 'asset-2',
              relationshipType: 'runs',
              direction: 'out',
              created: '2026-01-01',
            },
          ],
          meta: { currentPage: 1, totalItems: 1, pageSize: 50, totalPages: 1 },
        });
      })
    );

    const result = await assetsHandler.handleCall('blackpoint_assets_relationships', {
      assetId: 'asset-1',
      class: 'SOFTWARE',
      direction: 'in',
      tenantId: 'tenant-1',
    });

    expect(result.isError).toBeFalsy();
    const url = new URL(seen[0]!.url);
    expect(url.pathname).toBe('/v1/assets/asset-1/relationships');
    expect(url.searchParams.get('entityClass')).toBe('SOFTWARE');
    expect(url.searchParams.get('direction')).toBe('in');
    expect(url.searchParams.has('class')).toBe(false);
    expect(seen[0]!.tenantId).toBe('tenant-1');
    expect((result.content[0] as { text: string }).text).toMatch(/In relationships for asset asset-1/);
  });

  it('lists and gets alert groups with skip/take and status', async () => {
    server.use(
      http.get(`${LIVE}/v1/alert-groups`, ({ request }) => {
        record(request);
        return HttpResponse.json({
          data: [
            {
              id: 'ag-1',
              status: 'OPEN',
              alertCount: 2,
              hostname: 'host-a',
              username: 'ada',
            },
          ],
          meta: { skip: 10, take: 25, totalItems: 80 },
        });
      }),
      http.get(`${LIVE}/v1/alert-groups/:id`, ({ request }) => {
        record(request);
        return HttpResponse.json({
          id: 'ag-1',
          status: 'RESOLVED',
          alertCount: 2,
          hostname: 'host-a',
          tenantId: 'tenant-1',
        });
      })
    );

    const listed = await detectionsHandler.handleCall('blackpoint_detections_list', {
      tenantId: 'tenant-1',
      status: 'OPEN',
      skip: 10,
      take: 25,
    });
    const got = await detectionsHandler.handleCall('blackpoint_detections_get', {
      id: 'ag-1',
      tenantId: 'tenant-1',
    });

    expect(listed.isError).toBeFalsy();
    expect((listed.content[0] as { text: string }).text).toMatch(/skip 10, take 25 of 80/);
    const listUrl = new URL(seen[0]!.url);
    expect(listUrl.pathname).toBe('/v1/alert-groups');
    expect(listUrl.searchParams.get('skip')).toBe('10');
    expect(listUrl.searchParams.get('take')).toBe('25');
    expect(listUrl.searchParams.get('status')).toBe('OPEN');
    expect(listUrl.searchParams.has('page')).toBe(false);
    expect(seen[0]!.tenantId).toBe('tenant-1');

    expect(got.isError).toBeFalsy();
    expect(new URL(seen[1]!.url).pathname).toBe('/v1/alert-groups/ag-1');
    expect(seen[1]!.tenantId).toBe('tenant-1');
  });

  it('does not use the process env base URL when the gateway context omits the header', async () => {
    process.env.BLACKPOINT_BASE_URL = 'https://api.compassone.blackpointcyber.com';
    server.use(
      http.get(`${LIVE}/v1/assets`, ({ request }) => {
        record(request);
        return assetPage();
      })
    );

    const result = await requestContext.run(
      {
        apiToken: TOKEN,
        server: null,
        navigationState: freshNavigationState(),
      },
      () =>
        assetsHandler.handleCall('blackpoint_assets_list', {
          class: 'USER',
          tenantId: 'tenant-1',
        })
    );

    expect(result.isError).toBeFalsy();
    expect(new URL(seen[0]!.url).origin).toBe(LIVE);
    expect(new URL(seen[0]!.url).hostname).not.toContain('compassone');
  });

  it.each([
    [401, /API key is invalid or this account is not entitled/, /HTTP 401/],
    [403, /API key is invalid or this account is not entitled/, /HTTP 403/],
    [404, /base URL or path is wrong/, /HTTP 404/],
  ] as const)('surfaces HTTP %s as a tool error and logs status, path, and body', async (status, message, statusText) => {
    server.use(
      http.get(`${LIVE}/v1/assets`, ({ request }) => {
        record(request);
        return HttpResponse.json(
          {
            message: `failure ${TOKEN}`,
            Authorization: `Bearer ${TOKEN}`,
          },
          { status }
        );
      })
    );
    const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});

    const result = await assetsHandler.handleCall('blackpoint_assets_list', {
      class: 'DEVICE',
      tenantId: 'tenant-1',
    });

    expect(result.isError).toBe(true);
    const body = (result.content[0] as { text: string }).text;
    expect(body).toMatch(message);
    expect(body).toMatch(statusText);
    expect(body).toMatch(/GET \/v1\/assets/);
    if (status === 404) {
      expect(body).toMatch(/https:\/\/api\.blackpointcyber\.com\/v1/);
    }

    const logged = spy.mock.calls[0]?.[1] as {
      status: number;
      path: string;
      method: string;
      body: unknown;
    };
    expect(logged.status).toBe(status);
    expect(logged.method).toBe('GET');
    expect(logged.path).toContain('/v1/assets');
    expect(logged.body).toBeTruthy();
    const serialized = JSON.stringify(logged);
    expect(serialized).not.toBe('{}');
    expect(serialized).not.toContain(TOKEN);
    spy.mockRestore();
  });
});
