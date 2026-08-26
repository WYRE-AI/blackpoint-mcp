import { describe, it, expect, vi, beforeEach } from 'vitest';

// vulnerabilitiesHandler.handleCall() had zero test coverage across all four
// of its tools (list, scans_list, darkweb_list, external_list) — none of the
// pass-through arg forwarding or the response formatting had been exercised.
const { getClient } = vi.hoisted(() => ({ getClient: vi.fn() }));
vi.mock('../utils/client.js', () => ({ getClient }));

import { vulnerabilitiesHandler } from '../domains/vulnerabilities.js';

function text(result: Awaited<ReturnType<typeof vulnerabilitiesHandler.handleCall>>): string {
  return (result.content[0] as { text: string }).text;
}

describe('vulnerabilitiesHandler', () => {
  beforeEach(() => {
    getClient.mockReset();
  });

  describe('getTools', () => {
    it('exposes all four vulnerability tools', () => {
      expect(vulnerabilitiesHandler.getTools().map(t => t.name)).toEqual([
        'blackpoint_vulnerabilities_list',
        'blackpoint_vulnerabilities_scans_list',
        'blackpoint_vulnerabilities_darkweb_list',
        'blackpoint_vulnerabilities_external_list',
      ]);
    });
  });

  describe('blackpoint_vulnerabilities_list', () => {
    it('forwards args as-is and formats findings including CVE/CVSS/patch/exploit flags', async () => {
      const listVulnerabilities = vi.fn().mockResolvedValue({
        data: [
          {
            id: 'v1',
            title: 'Log4Shell',
            severity: 'critical',
            cveId: 'CVE-2021-44228',
            cvssScore: 10,
            patchAvailable: true,
            exploitAvailable: true,
          },
        ],
      });
      getClient.mockResolvedValue({ vulnerabilities: { listVulnerabilities } });

      const args = { severity: ['critical'], cveId: 'CVE-2021-44228' };
      const result = await vulnerabilitiesHandler.handleCall('blackpoint_vulnerabilities_list', args);

      expect(listVulnerabilities).toHaveBeenCalledWith(args);
      expect(result.isError).toBeFalsy();
      expect(text(result)).toMatch(/Found 1 vulnerabilities/);
      expect(text(result)).toMatch(
        /Log4Shell \(v1\) - Severity: critical - CVE: CVE-2021-44228 - CVSS: 10 - Patch available - Exploit available/
      );
    });

    it('returns an isError result instead of throwing when the client rejects', async () => {
      const listVulnerabilities = vi.fn().mockRejectedValue(new Error('boom'));
      getClient.mockResolvedValue({ vulnerabilities: { listVulnerabilities } });

      const result = await vulnerabilitiesHandler.handleCall('blackpoint_vulnerabilities_list', {});

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/Failed to list vulnerabilities/);
    });
  });

  describe('blackpoint_vulnerabilities_scans_list', () => {
    it('forwards args and formats scan status', async () => {
      const listScans = vi.fn().mockResolvedValue([
        { id: 's1', status: 'completed', vulnerabilityCount: 3, startedAt: 'a', completedAt: 'b' },
      ]);
      getClient.mockResolvedValue({ vulnerabilities: { listScans } });

      const args = { tenantId: 't1' };
      const result = await vulnerabilitiesHandler.handleCall('blackpoint_vulnerabilities_scans_list', args);

      expect(listScans).toHaveBeenCalledWith(args);
      expect(text(result)).toMatch(/Found 1 vulnerability scans/);
      expect(text(result)).toMatch(/Scan s1 - Status: completed - Vulns found: 3/);
    });

    it('returns an isError result when the client rejects', async () => {
      const listScans = vi.fn().mockRejectedValue(new Error('boom'));
      getClient.mockResolvedValue({ vulnerabilities: { listScans } });

      const result = await vulnerabilitiesHandler.handleCall('blackpoint_vulnerabilities_scans_list', {});

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/Failed to list scans/);
    });
  });

  describe('blackpoint_vulnerabilities_darkweb_list', () => {
    it('forwards args and formats exposures', async () => {
      const listDarkWebExposures = vi.fn().mockResolvedValue({
        data: [
          {
            id: 'e1',
            exposureType: 'credentials',
            severity: 'high',
            source: 'breach-db',
            discoveredDate: '2026-01-01',
          },
        ],
      });
      getClient.mockResolvedValue({ vulnerabilities: { listDarkWebExposures } });

      const args = { exposureType: ['credentials'] };
      const result = await vulnerabilitiesHandler.handleCall('blackpoint_vulnerabilities_darkweb_list', args);

      expect(listDarkWebExposures).toHaveBeenCalledWith(args);
      expect(text(result)).toMatch(/Found 1 dark web exposures/);
      expect(text(result)).toMatch(/credentials exposure \(e1\) - Severity: high - Source: breach-db/);
    });

    it('returns an isError result when the client rejects', async () => {
      const listDarkWebExposures = vi.fn().mockRejectedValue(new Error('boom'));
      getClient.mockResolvedValue({ vulnerabilities: { listDarkWebExposures } });

      const result = await vulnerabilitiesHandler.handleCall('blackpoint_vulnerabilities_darkweb_list', {});

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/Failed to list dark web exposures/);
    });
  });

  describe('blackpoint_vulnerabilities_external_list', () => {
    it('forwards args and formats exposures', async () => {
      const listExternalExposures = vi.fn().mockResolvedValue({
        data: [
          {
            id: 'x1',
            exposureType: 'open_port',
            severity: 'medium',
            assetId: 'a1',
            discoveredDate: '2026-01-01',
          },
        ],
      });
      getClient.mockResolvedValue({ vulnerabilities: { listExternalExposures } });

      const args = { severity: ['medium'] };
      const result = await vulnerabilitiesHandler.handleCall('blackpoint_vulnerabilities_external_list', args);

      expect(listExternalExposures).toHaveBeenCalledWith(args);
      expect(text(result)).toMatch(/Found 1 external exposures/);
      expect(text(result)).toMatch(/open_port \(x1\) - Severity: medium - Asset: a1/);
    });

    it('returns an isError result when the client rejects', async () => {
      const listExternalExposures = vi.fn().mockRejectedValue(new Error('boom'));
      getClient.mockResolvedValue({ vulnerabilities: { listExternalExposures } });

      const result = await vulnerabilitiesHandler.handleCall('blackpoint_vulnerabilities_external_list', {});

      expect(result.isError).toBe(true);
      expect(text(result)).toMatch(/Failed to list external exposures/);
    });
  });

  describe('handleCall: unknown tool', () => {
    it('returns an isError result without calling the client', async () => {
      const listVulnerabilities = vi.fn();
      getClient.mockResolvedValue({ vulnerabilities: { listVulnerabilities } });

      const result = await vulnerabilitiesHandler.handleCall('blackpoint_bogus', {});

      expect(result.isError).toBe(true);
      expect(listVulnerabilities).not.toHaveBeenCalled();
    });
  });
});
