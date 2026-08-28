import { describe, it, expect, vi, beforeEach } from 'vitest';

// tenantsHandler.handleCall() had zero test coverage: no test asserted what
// params it sends to the underlying CompassOne client, how it formats a
// paginated vs. bare-array response, or that a client rejection is turned
// into an isError result rather than an unhandled rejection.
const { getClient } = vi.hoisted(() => ({ getClient: vi.fn() }));
vi.mock('../utils/client.js', () => ({ getClient }));

import { tenantsHandler } from '../domains/tenants.js';

function text(result: Awaited<ReturnType<typeof tenantsHandler.handleCall>>): string {
  return (result.content[0] as { text: string }).text;
}

describe('tenantsHandler', () => {
  beforeEach(() => {
    getClient.mockReset();
  });

  describe('getTools', () => {
    it('exposes exactly the list and get tools', () => {
      expect(tenantsHandler.getTools().map(t => t.name)).toEqual([
        'blackpoint_tenants_list',
        'blackpoint_tenants_get',
      ]);
    });
  });

  describe('blackpoint_tenants_list', () => {
    it('forwards filter args to client.tenants.list and formats a paginated response', async () => {
      const list = vi.fn().mockResolvedValue({
        data: [{ id: 't1', name: 'Acme', status: 'active', accountId: 'a1', created: '2026-01-01' }],
        pagination: { page: 1, pageSize: 50, totalCount: 1 },
      });
      getClient.mockResolvedValue({ tenants: { list } });

      const result = await tenantsHandler.handleCall('blackpoint_tenants_list', {
        accountId: 'a1',
        status: ['active'],
        search: 'acme',
        page: 1,
        pageSize: 50,
      });

      expect(list).toHaveBeenCalledWith({
        accountId: 'a1',
        status: ['active'],
        search: 'acme',
        page: 1,
        pageSize: 50,
      });
      expect(result.isError).toBeFalsy();
      expect(text(result)).toMatch(/Found 1 tenants \(Page 1 of 1\)/);
      expect(text(result)).toMatch(/Acme \(t1\) - Status: active - Account: a1 - Created: 2026-01-01/);
    });

    it('handles a bare-array response with no pagination wrapper', async () => {
      const list = vi.fn().mockResolvedValue([{ id: 't2', name: 'Beta' }]);
      getClient.mockResolvedValue({ tenants: { list } });

      const result = await tenantsHandler.handleCall('blackpoint_tenants_list', {});

      expect(text(result)).toMatch(/^Found 1 tenants\n/);
      expect(text(result)).not.toMatch(/Page/);
    });

    it('returns an isError result instead of throwing when the client rejects', async () => {
      const list = vi.fn().mockRejectedValue(new Error('boom'));
      getClient.mockResolvedValue({ tenants: { list } });

      const result = await tenantsHandler.handleCall('blackpoint_tenants_list', {});

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/Failed to list tenants/);
    });
  });

  describe('blackpoint_tenants_get', () => {
    it('fetches by id and formats full tenant details', async () => {
      const get = vi.fn().mockResolvedValue({
        id: 't1',
        name: 'Acme',
        status: 'active',
        accountId: 'a1',
        description: 'A widget company',
        created: '2026-01-01',
        updated: '2026-01-02',
      });
      getClient.mockResolvedValue({ tenants: { get } });

      const result = await tenantsHandler.handleCall('blackpoint_tenants_get', { id: 't1' });

      expect(get).toHaveBeenCalledWith('t1');
      expect(text(result)).toMatch(/Tenant: Acme \(t1\)/);
      expect(text(result)).toMatch(/Status: active/);
      expect(text(result)).toMatch(/Description: A widget company/);
    });

    it('returns an isError result when the client rejects', async () => {
      const get = vi.fn().mockRejectedValue(new Error('not found'));
      getClient.mockResolvedValue({ tenants: { get } });

      const result = await tenantsHandler.handleCall('blackpoint_tenants_get', { id: 'missing' });

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/Failed to get tenant missing/);
    });
  });

  describe('handleCall: unknown tool', () => {
    it('returns an isError result without calling the client', async () => {
      const list = vi.fn();
      const get = vi.fn();
      getClient.mockResolvedValue({ tenants: { list, get } });

      const result = await tenantsHandler.handleCall('blackpoint_bogus', {});

      expect(result.isError).toBe(true);
      expect(list).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
    });
  });
});
