import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult, RequestHandlerExtra } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { toolFailure } from '../utils/service-error.js';

function getTools(): Tool[] {
  return [
    {
      name: 'blackpoint_vulnerabilities_list',
      description: 'List vulnerability findings with filtering options',
      inputSchema: {
        type: 'object',
        properties: {
          assetId: {
            type: 'string',
            description: 'Filter by specific asset ID',
          },
          tenantId: {
            type: 'string',
            description: 'Filter by specific tenant ID',
          },
          severity: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'critical'],
            },
            description: 'Filter by severity levels',
          },
          status: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['open', 'fixed', 'ignored', 'false_positive'],
            },
            description: 'Filter by vulnerability status',
          },
          cveId: {
            type: 'string',
            description: 'Filter by specific CVE ID',
          },
          patchAvailable: {
            type: 'boolean',
            description: 'Filter by patch availability',
          },
          exploitAvailable: {
            type: 'boolean',
            description: 'Filter by exploit availability',
          },
          page: {
            type: 'number',
            description: 'Page number (default: 1)',
            minimum: 1,
          },
          pageSize: {
            type: 'number',
            description: 'Items per page (default: 50)',
            minimum: 1,
            maximum: 100,
          },
        },
      },
    },
    {
      name: 'blackpoint_vulnerabilities_scans_list',
      description: 'List vulnerability scans with their status',
      inputSchema: {
        type: 'object',
        properties: {
          tenantId: {
            type: 'string',
            description: 'Filter by specific tenant ID',
          },
          status: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['pending', 'running', 'completed', 'failed'],
            },
            description: 'Filter by scan status',
          },
          assetId: {
            type: 'string',
            description: 'Filter by specific asset ID',
          },
          page: {
            type: 'number',
            description: 'Page number (default: 1)',
            minimum: 1,
          },
        },
      },
    },
    {
      name: 'blackpoint_vulnerabilities_darkweb_list',
      description: 'List dark web exposures for monitoring',
      inputSchema: {
        type: 'object',
        properties: {
          tenantId: {
            type: 'string',
            description: 'Filter by specific tenant ID',
          },
          exposureType: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['credentials', 'documents', 'data_breach', 'malware'],
            },
            description: 'Filter by exposure type',
          },
          severity: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'critical'],
            },
            description: 'Filter by severity levels',
          },
          page: {
            type: 'number',
            description: 'Page number (default: 1)',
            minimum: 1,
          },
        },
      },
    },
    {
      name: 'blackpoint_vulnerabilities_external_list',
      description: 'List external exposure findings',
      inputSchema: {
        type: 'object',
        properties: {
          tenantId: {
            type: 'string',
            description: 'Filter by specific tenant ID',
          },
          exposureType: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['open_port', 'vulnerable_service', 'certificate_issue', 'misconfiguration'],
            },
            description: 'Filter by exposure type',
          },
          severity: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'critical'],
            },
            description: 'Filter by severity levels',
          },
          page: {
            type: 'number',
            description: 'Page number (default: 1)',
            minimum: 1,
          },
        },
      },
    },
  ];
}

async function handleCall(
  toolName: string,
  args: Record<string, unknown>,
  extra?: RequestHandlerExtra
): Promise<CallToolResult> {
  const client = await getClient();

  switch (toolName) {
    case 'blackpoint_vulnerabilities_list': {
      try {
        const response = await client.vulnerabilities.listVulnerabilities(args as any);
        const items = Array.isArray(response) ? response : (response?.data ?? []);

        const resultText = [
          `Found ${items.length} vulnerabilities`,
          '',
          ...items.map((vuln: any) =>
            `• ${vuln.title} (${vuln.id})` +
            (vuln.severity ? ` - Severity: ${vuln.severity}` : '') +
            (vuln.cveId ? ` - CVE: ${vuln.cveId}` : '') +
            (vuln.cvssScore ? ` - CVSS: ${vuln.cvssScore}` : '') +
            (vuln.patchAvailable ? ' - Patch available' : '') +
            (vuln.exploitAvailable ? ' - Exploit available' : '')
          ),
        ].join('\n');

        return { content: [{ type: 'text', text: resultText }] };
      } catch (error) {
        return toolFailure('Failed to list vulnerabilities', error);
      }
    }

    case 'blackpoint_vulnerabilities_scans_list': {
      try {
        const response = await client.vulnerabilities.listScans(args as any);
        const items = Array.isArray(response) ? response : (response?.data ?? []);

        const resultText = [
          `Found ${items.length} vulnerability scans`,
          '',
          ...items.map((scan: any) =>
            `• Scan ${scan.id}` +
            (scan.status ? ` - Status: ${scan.status}` : '') +
            (scan.vulnerabilityCount ? ` - Vulns found: ${scan.vulnerabilityCount}` : '') +
            (scan.startedAt ? ` - Started: ${scan.startedAt}` : '') +
            (scan.completedAt ? ` - Completed: ${scan.completedAt}` : '')
          ),
        ].join('\n');

        return { content: [{ type: 'text', text: resultText }] };
      } catch (error) {
        return toolFailure('Failed to list scans', error);
      }
    }

    case 'blackpoint_vulnerabilities_darkweb_list': {
      try {
        const response = await client.vulnerabilities.listDarkWebExposures(args as any);
        const items = Array.isArray(response) ? response : (response?.data ?? []);

        const resultText = [
          `Found ${items.length} dark web exposures`,
          '',
          ...items.map((exposure: any) =>
            `• ${exposure.exposureType} exposure (${exposure.id})` +
            (exposure.severity ? ` - Severity: ${exposure.severity}` : '') +
            (exposure.description ? ` - ${exposure.description}` : '') +
            (exposure.source ? ` - Source: ${exposure.source}` : '') +
            (exposure.discoveredDate ? ` - Discovered: ${exposure.discoveredDate}` : '')
          ),
        ].join('\n');

        return { content: [{ type: 'text', text: resultText }] };
      } catch (error) {
        return toolFailure('Failed to list dark web exposures', error);
      }
    }

    case 'blackpoint_vulnerabilities_external_list': {
      try {
        const response = await client.vulnerabilities.listExternalExposures(args as any);
        const items = Array.isArray(response) ? response : (response?.data ?? []);

        const resultText = [
          `Found ${items.length} external exposures`,
          '',
          ...items.map((exposure: any) =>
            `• ${exposure.exposureType} (${exposure.id})` +
            (exposure.severity ? ` - Severity: ${exposure.severity}` : '') +
            (exposure.description ? ` - ${exposure.description}` : '') +
            (exposure.assetId ? ` - Asset: ${exposure.assetId}` : '') +
            (exposure.discoveredDate ? ` - Discovered: ${exposure.discoveredDate}` : '')
          ),
        ].join('\n');

        return { content: [{ type: 'text', text: resultText }] };
      } catch (error) {
        return toolFailure('Failed to list external exposures', error);
      }
    }

    default:
      return {
        content: [{ type: 'text', text: `Unknown vulnerabilities tool: ${toolName}` }],
        isError: true,
      };
  }
}

export const vulnerabilitiesHandler: DomainHandler = { getTools, handleCall };