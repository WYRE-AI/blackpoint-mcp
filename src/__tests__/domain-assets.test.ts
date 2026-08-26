import { describe, it, expect, vi, beforeEach } from 'vitest';

// assetsHandler.handleCall() had zero test coverage. It's the largest and
// most logic-heavy domain handler in this repo (290 lines): param mapping
// for list/get, relationship-direction formatting, and — the one with real
// business logic worth pinning — blackpoint_assets_search, which fans out
// N calls to client.assets.list() (one per asset class) and then filters
// the aggregate by tenantIds client-side.
const { getClient } = vi.hoisted(() => ({ getClient: vi.fn() }));
vi.mock('../utils/client.js', () => ({ getClient }));

import { assetsHandler } from '../domains/assets.js';

function text(result: Awaited<ReturnType<typeof assetsHandler.handleCall>>): string {
  return (result.content[0] as { text: string }).text;
}

describe('assetsHandler', () => {
  beforeEach(() => {
    getClient.mockReset();
  });

  describe('getTools', () => {
    it('exposes list, get, relationships and search tools', () => {
      expect(assetsHandler.getTools().map(t => t.name)).toEqual([
        'blackpoint_assets_list',
        'blackpoint_assets_get',
        'blackpoint_assets_relationships',
        'blackpoint_assets_search',
      ]);
    });

    it('requires class on blackpoint_assets_list', () => {
      const list = assetsHandler.getTools().find(t => t.name === 'blackpoint_assets_list')!;
      expect((list.inputSchema as { required: string[] }).required).toEqual(['class']);
    });
  });

  describe('blackpoint_assets_list', () => {
    it('forwards filter args to client.assets.list and formats a paginated response', async () => {
      const list = vi.fn().mockResolvedValue({
        data: [
          {
            id: 'a1',
            displayName: 'web-01',
            tenantId: 't1',
            status: 'active',
            lastSeenOn: '2026-01-01',
          },
        ],
        pagination: { page: 1, pageSize: 50, totalCount: 1 },
      });
      getClient.mockResolvedValue({ assets: { list } });

      const result = await assetsHandler.handleCall('blackpoint_assets_list', {
        class: 'server',
        tenantId: 't1',
        search: 'web',
        status: 'active',
        page: 1,
        pageSize: 50,
      });

      expect(list).toHaveBeenCalledWith({
        class: 'server',
        search: 'web',
        page: 1,
        pageSize: 50,
        tenantId: 't1',
      });
      expect(result.isError).toBeFalsy();
      expect(text(result)).toMatch(/Found 1 server assets \(Page 1 of 1\)/);
      expect(text(result)).toMatch(/web-01 \(a1\) - Tenant: t1 - Status: active - Last seen: 2026-01-01/);
    });

    it('returns an isError result instead of throwing when the client rejects', async () => {
      const list = vi.fn().mockRejectedValue(new Error('boom'));
      getClient.mockResolvedValue({ assets: { list } });

      const result = await assetsHandler.handleCall('blackpoint_assets_list', { class: 'endpoint' });

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/Failed to list assets/);
    });
  });

  describe('blackpoint_assets_get', () => {
    it('fetches by id and formats full asset details', async () => {
      const get = vi.fn().mockResolvedValue({
        id: 'a1',
        displayName: 'web-01',
        assetClass: 'server',
        status: 'active',
        tenantId: 't1',
        criticality: 'high',
      });
      getClient.mockResolvedValue({ assets: { get } });

      const result = await assetsHandler.handleCall('blackpoint_assets_get', { id: 'a1' });

      expect(get).toHaveBeenCalledWith('a1');
      expect(text(result)).toMatch(/Asset: web-01 \(a1\)/);
      expect(text(result)).toMatch(/Class: server/);
      expect(text(result)).toMatch(/Criticality: high/);
    });

    it('returns an isError result when the client rejects', async () => {
      const get = vi.fn().mockRejectedValue(new Error('not found'));
      getClient.mockResolvedValue({ assets: { get } });

      const result = await assetsHandler.handleCall('blackpoint_assets_get', { id: 'missing' });

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/Failed to get asset missing/);
    });
  });

  describe('blackpoint_assets_relationships', () => {
    it('lists relationships in the requested direction', async () => {
      const listRelationships = vi.fn().mockResolvedValue({
        data: [{ relationshipType: 'connects-to', targetAssetId: 'a2', created: '2026-01-01' }],
      });
      getClient.mockResolvedValue({ assets: { listRelationships } });

      const result = await assetsHandler.handleCall('blackpoint_assets_relationships', {
        assetId: 'a1',
        class: 'server',
        direction: 'child',
      });

      expect(listRelationships).toHaveBeenCalledWith('a1', { class: 'server', direction: 'child' });
      expect(text(result)).toMatch(/Child relationships for asset a1:/);
      expect(text(result)).toMatch(/connects-to: a2 \(created 2026-01-01\)/);
    });

    it('returns an isError result when the client rejects', async () => {
      const listRelationships = vi.fn().mockRejectedValue(new Error('boom'));
      getClient.mockResolvedValue({ assets: { listRelationships } });

      const result = await assetsHandler.handleCall('blackpoint_assets_relationships', {
        assetId: 'a1',
        class: 'server',
        direction: 'parent',
      });

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/Failed to list relationships for asset a1/);
    });
  });

  describe('blackpoint_assets_search', () => {
    it('defaults to searching every asset class when none is specified', async () => {
      const list = vi.fn().mockResolvedValue([]);
      getClient.mockResolvedValue({ assets: { list } });

      await assetsHandler.handleCall('blackpoint_assets_search', { query: 'web' });

      expect(list).toHaveBeenCalledTimes(6);
      const searchedClasses = list.mock.calls.map(call => (call[0] as { class: string }).class);
      expect(searchedClasses).toEqual(['endpoint', 'server', 'network', 'cloud', 'mobile', 'iot']);
      for (const call of list.mock.calls) {
        expect(call[0]).toMatchObject({ search: 'web' });
      }
    });

    it('restricts the fan-out to the requested classes only', async () => {
      const list = vi.fn().mockResolvedValue([]);
      getClient.mockResolvedValue({ assets: { list } });

      await assetsHandler.handleCall('blackpoint_assets_search', {
        query: 'db',
        classes: ['server', 'cloud'],
      });

      expect(list).toHaveBeenCalledTimes(2);
      expect(list.mock.calls.map(call => (call[0] as { class: string }).class)).toEqual(['server', 'cloud']);
    });

    it('aggregates results across classes and applies the tenantIds filter client-side', async () => {
      const list = vi
        .fn()
        .mockResolvedValueOnce([
          { id: 'a1', displayName: 'web-01', assetClass: 'server', tenantId: 'tenant-a' },
        ])
        .mockResolvedValueOnce([
          { id: 'a2', displayName: 'db-01', assetClass: 'cloud', tenantId: 'tenant-b' },
        ]);
      getClient.mockResolvedValue({ assets: { list } });

      const result = await assetsHandler.handleCall('blackpoint_assets_search', {
        query: 'x',
        classes: ['server', 'cloud'],
        tenantIds: ['tenant-a'],
      });

      expect(text(result)).toMatch(/Found 1 assets across server, cloud classes/);
      expect(text(result)).toMatch(/web-01 \(server\) - a1 - Tenant: tenant-a/);
      expect(text(result)).not.toMatch(/db-01/);
    });

    it('returns an isError result instead of throwing when any class lookup rejects', async () => {
      const list = vi.fn().mockRejectedValue(new Error('boom'));
      getClient.mockResolvedValue({ assets: { list } });

      const result = await assetsHandler.handleCall('blackpoint_assets_search', {
        query: 'x',
        classes: ['server'],
      });

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/Failed to search assets/);
    });
  });

  describe('handleCall: unknown tool', () => {
    it('returns an isError result without calling the client', async () => {
      const list = vi.fn();
      getClient.mockResolvedValue({ assets: { list } });

      const result = await assetsHandler.handleCall('blackpoint_bogus', {});

      expect(result.isError).toBe(true);
      expect(list).not.toHaveBeenCalled();
    });
  });
});
