import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuthenticationError, NotFoundError } from '@wyre-ai/node-blackpoint';

const { getClient } = vi.hoisted(() => ({ getClient: vi.fn() }));
vi.mock('../utils/client.js', () => ({ getClient }));

import { detectionsHandler } from '../domains/detections.js';
import { logger } from '../utils/logger.js';

function text(result: Awaited<ReturnType<typeof detectionsHandler.handleCall>>): string {
  return (result.content[0] as { text: string }).text;
}

describe('detectionsHandler', () => {
  beforeEach(() => {
    getClient.mockReset();
  });

  describe('getTools', () => {
    it('keeps the detections tool names and advertises alert-group paging', () => {
      const tools = detectionsHandler.getTools();
      expect(tools.map(t => t.name)).toEqual([
        'blackpoint_detections_list',
        'blackpoint_detections_get',
      ]);

      const list = tools[0]!;
      const schema = list.inputSchema as {
        required: string[];
        properties: {
          status: { enum: string[] };
          skip: { type: string };
          take: { type: string };
          page?: unknown;
          pageSize?: unknown;
        };
      };
      expect(schema.required).toEqual(['tenantId']);
      expect(schema.properties.status.enum).toEqual(['OPEN', 'RESOLVED']);
      expect(schema.properties.skip.type).toBe('number');
      expect(schema.properties.take.type).toBe('number');
      expect(schema.properties.page).toBeUndefined();
      expect(schema.properties.pageSize).toBeUndefined();

      const get = tools[1]!;
      expect((get.inputSchema as { required: string[] }).required).toEqual(['id', 'tenantId']);
    });
  });

  describe('blackpoint_detections_list', () => {
    it('calls alert groups with skip/take and status and formats meta pagination', async () => {
      const list = vi.fn().mockResolvedValue({
        data: [
          {
            id: 'ag-1',
            hostname: 'host-a',
            status: 'OPEN',
            alertCount: 2,
            alertTypes: ['CR'],
            username: 'ada',
          },
        ],
        pagination: { skip: 0, take: 50, totalCount: 80 },
      });
      getClient.mockResolvedValue({ alertGroups: { list } });

      const result = await detectionsHandler.handleCall('blackpoint_detections_list', {
        tenantId: 't1',
        status: 'OPEN',
        skip: 0,
        take: 50,
        search: 'host',
        since: '2026-09-01T00:00:00Z',
      });

      expect(list).toHaveBeenCalledWith({
        tenantId: 't1',
        status: 'OPEN',
        skip: 0,
        take: 50,
        search: 'host',
        since: '2026-09-01T00:00:00Z',
      });
      expect(result.isError).toBeFalsy();
      expect(text(result)).toMatch(/Found 1 alert groups \(skip 0, take 50 of 80\)/);
      expect(text(result)).toMatch(/host-a \(ag-1\) - Status: OPEN - Alerts: 2 - Types: CR - User: ada/);
    });

    it('rejects legacy detection statuses instead of sending them', async () => {
      const list = vi.fn();
      getClient.mockResolvedValue({ alertGroups: { list } });

      const result = await detectionsHandler.handleCall('blackpoint_detections_list', {
        tenantId: 't1',
        status: 'new',
      });

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/status must be OPEN or RESOLVED/);
      expect(list).not.toHaveBeenCalled();
    });

    it('handles a bare-array response with no pagination wrapper', async () => {
      const list = vi.fn().mockResolvedValue([{ id: 'ag-2', hostname: 'host-b', status: 'RESOLVED' }]);
      getClient.mockResolvedValue({ alertGroups: { list } });

      const result = await detectionsHandler.handleCall('blackpoint_detections_list', { tenantId: 't1' });

      expect(text(result)).toMatch(/^Found 1 alert groups\n/);
      expect(text(result)).not.toMatch(/skip/);
    });

    it('returns an isError result instead of throwing when the client rejects', async () => {
      const list = vi.fn().mockRejectedValue(new Error('boom'));
      getClient.mockResolvedValue({ alertGroups: { list } });

      const result = await detectionsHandler.handleCall('blackpoint_detections_list', { tenantId: 't1' });

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/Failed to list detections/);
    });

    it('tells the caller a 401 is a bad key or missing entitlement and logs toJSON()', async () => {
      const error = new AuthenticationError(
        'unauthorized',
        { message: 'unauthorized', token: 'super-secret-token' },
        '/v1/alert-groups',
        'GET',
        'super-secret-token'
      );
      const list = vi.fn().mockRejectedValue(error);
      getClient.mockResolvedValue({ alertGroups: { list } });
      const spy = vi.spyOn(logger, 'error').mockImplementation(() => {});

      const result = await detectionsHandler.handleCall('blackpoint_detections_list', { tenantId: 't1' });

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/API key is invalid or this account is not entitled/);
      expect(text(result)).toMatch(/HTTP 401/);
      expect(text(result)).toMatch(/\/v1\/alert-groups/);
      const logged = spy.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(logged).toMatchObject({ status: 401, path: '/v1/alert-groups', method: 'GET' });
      expect(JSON.stringify(logged)).not.toBe('{}');
      expect(JSON.stringify(logged)).not.toContain('super-secret-token');
      spy.mockRestore();
    });
  });

  describe('blackpoint_detections_get', () => {
    it('fetches an alert group by id with tenantId', async () => {
      const get = vi.fn().mockResolvedValue({
        id: 'ag-1',
        hostname: 'host-a',
        status: 'OPEN',
        alertCount: 2,
        alertTypes: ['MDR'],
        username: 'ada',
        type: 'MDR',
        tenantId: 't1',
        created: '2026-01-01',
      });
      getClient.mockResolvedValue({ alertGroups: { get } });

      const result = await detectionsHandler.handleCall('blackpoint_detections_get', {
        id: 'ag-1',
        tenantId: 't1',
      });

      expect(get).toHaveBeenCalledWith('ag-1', { tenantId: 't1' });
      expect(text(result)).toMatch(/Alert group: host-a \(ag-1\)/);
      expect(text(result)).toMatch(/Status: OPEN/);
      expect(text(result)).toMatch(/Types: MDR/);
      expect(text(result)).toMatch(/User: ada/);
    });

    it('omits optional lines when the fields are absent', async () => {
      const get = vi.fn().mockResolvedValue({ id: 'ag-3', status: 'RESOLVED' });
      getClient.mockResolvedValue({ alertGroups: { get } });

      const result = await detectionsHandler.handleCall('blackpoint_detections_get', {
        id: 'ag-3',
        tenantId: 't1',
      });

      expect(text(result)).not.toMatch(/Types:/);
      expect(text(result)).not.toMatch(/User:/);
    });

    it('says a 404 is a wrong base URL or path', async () => {
      const get = vi.fn().mockRejectedValue(
        new NotFoundError('missing', { message: 'not found' }, '/v1/alert-groups/missing', 'GET')
      );
      getClient.mockResolvedValue({ alertGroups: { get } });

      const result = await detectionsHandler.handleCall('blackpoint_detections_get', {
        id: 'missing',
        tenantId: 't1',
      });

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/Failed to get detection missing/);
      expect(text(result)).toMatch(/HTTP 404/);
      expect(text(result)).toMatch(/base URL or path is wrong/);
      expect(text(result)).toMatch(/https:\/\/api\.blackpointcyber\.com\/v1/);
    });
  });

  describe('handleCall: unknown tool', () => {
    it('returns an isError result without calling the client', async () => {
      const list = vi.fn();
      const get = vi.fn();
      getClient.mockResolvedValue({ alertGroups: { list, get } });

      const result = await detectionsHandler.handleCall('blackpoint_bogus', {});

      expect(result.isError).toBe(true);
      expect(list).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
    });
  });
});
