import { describe, it, expect, vi, beforeEach } from 'vitest';

// detectionsHandler.handleCall() had zero test coverage: the param mapping
// into client.detections.{list,get}, the MITRE-tactic/technique formatting,
// and the error-to-isError path were all unverified.
const { getClient } = vi.hoisted(() => ({ getClient: vi.fn() }));
vi.mock('../utils/client.js', () => ({ getClient }));

import { detectionsHandler } from '../domains/detections.js';

function text(result: Awaited<ReturnType<typeof detectionsHandler.handleCall>>): string {
  return (result.content[0] as { text: string }).text;
}

describe('detectionsHandler', () => {
  beforeEach(() => {
    getClient.mockReset();
  });

  describe('getTools', () => {
    it('exposes exactly the list and get tools', () => {
      expect(detectionsHandler.getTools().map(t => t.name)).toEqual([
        'blackpoint_detections_list',
        'blackpoint_detections_get',
      ]);
    });
  });

  describe('blackpoint_detections_list', () => {
    it('forwards all filter args to client.detections.list and formats a paginated response', async () => {
      const list = vi.fn().mockResolvedValue({
        data: [
          {
            id: 'd1',
            ruleName: 'Suspicious PowerShell',
            severity: 'high',
            status: 'new',
            assetId: 'a1',
            created: '2026-01-01',
          },
        ],
        pagination: { page: 1, pageSize: 50, totalCount: 1 },
      });
      getClient.mockResolvedValue({ detections: { list } });

      const result = await detectionsHandler.handleCall('blackpoint_detections_list', {
        tenantId: 't1',
        assetId: 'a1',
        severity: ['high'],
        status: ['new'],
        fromDate: '2026-01-01',
        toDate: '2026-01-31',
        page: 1,
        pageSize: 50,
      });

      expect(list).toHaveBeenCalledWith({
        tenantId: 't1',
        assetId: 'a1',
        severity: ['high'],
        status: ['new'],
        fromDate: '2026-01-01',
        toDate: '2026-01-31',
        page: 1,
        pageSize: 50,
      });
      expect(result.isError).toBeFalsy();
      expect(text(result)).toMatch(/Found 1 detections \(Page 1 of 1\)/);
      expect(text(result)).toMatch(/Suspicious PowerShell \(d1\) - Severity: high - Status: new - Asset: a1/);
    });

    it('handles a bare-array response with no pagination wrapper', async () => {
      const list = vi.fn().mockResolvedValue([{ id: 'd2', ruleName: 'Rule 2' }]);
      getClient.mockResolvedValue({ detections: { list } });

      const result = await detectionsHandler.handleCall('blackpoint_detections_list', {});

      expect(text(result)).toMatch(/^Found 1 detections\n/);
      expect(text(result)).not.toMatch(/Page/);
    });

    it('returns an isError result instead of throwing when the client rejects', async () => {
      const list = vi.fn().mockRejectedValue(new Error('boom'));
      getClient.mockResolvedValue({ detections: { list } });

      const result = await detectionsHandler.handleCall('blackpoint_detections_list', {});

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/Failed to list detections/);
    });
  });

  describe('blackpoint_detections_get', () => {
    it('fetches by id and formats full detection details including MITRE fields', async () => {
      const get = vi.fn().mockResolvedValue({
        id: 'd1',
        ruleName: 'Suspicious PowerShell',
        severity: 'high',
        status: 'new',
        tenantId: 't1',
        assetId: 'a1',
        description: 'Encoded command execution',
        source: 'edr',
        timestamp: '2026-01-01T00:00:00Z',
        mitreTactics: ['Execution'],
        mitreTechniques: ['T1059.001'],
        created: '2026-01-01',
      });
      getClient.mockResolvedValue({ detections: { get } });

      const result = await detectionsHandler.handleCall('blackpoint_detections_get', { id: 'd1' });

      expect(get).toHaveBeenCalledWith('d1');
      expect(text(result)).toMatch(/Detection: Suspicious PowerShell \(d1\)/);
      expect(text(result)).toMatch(/MITRE Tactics: Execution/);
      expect(text(result)).toMatch(/MITRE Techniques: T1059\.001/);
    });

    it('omits MITRE lines when the fields are absent', async () => {
      const get = vi.fn().mockResolvedValue({
        id: 'd3',
        ruleName: 'Rule 3',
        severity: 'low',
        status: 'resolved',
      });
      getClient.mockResolvedValue({ detections: { get } });

      const result = await detectionsHandler.handleCall('blackpoint_detections_get', { id: 'd3' });

      expect(text(result)).not.toMatch(/MITRE/);
    });

    it('returns an isError result when the client rejects', async () => {
      const get = vi.fn().mockRejectedValue(new Error('not found'));
      getClient.mockResolvedValue({ detections: { get } });

      const result = await detectionsHandler.handleCall('blackpoint_detections_get', { id: 'missing' });

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/Failed to get detection missing/);
    });
  });

  describe('handleCall: unknown tool', () => {
    it('returns an isError result without calling the client', async () => {
      const list = vi.fn();
      const get = vi.fn();
      getClient.mockResolvedValue({ detections: { list, get } });

      const result = await detectionsHandler.handleCall('blackpoint_bogus', {});

      expect(result.isError).toBe(true);
      expect(list).not.toHaveBeenCalled();
      expect(get).not.toHaveBeenCalled();
    });
  });
});
