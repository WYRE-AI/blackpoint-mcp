import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type {
  AlertGroup,
  AlertGroupListParams,
  AlertGroupStatus,
} from '@wyre-ai/node-blackpoint';
import type { DomainHandler, CallToolResult, RequestHandlerExtra } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { formatPagination, pageItems } from '../utils/format-pagination.js';
import { toolFailure } from '../utils/service-error.js';

const ALERT_GROUP_STATUSES = ['OPEN', 'RESOLVED'] as const;

function readStatus(value: unknown): AlertGroupStatus | AlertGroupStatus[] | undefined {
  if (value === undefined || value === null) return undefined;
  const values = (Array.isArray(value) ? value : [value]).map(item => String(item));
  if (values.length === 0) return undefined;
  const invalid = values.filter(item => item !== 'OPEN' && item !== 'RESOLVED');
  if (invalid.length > 0) {
    throw new Error(`status must be OPEN or RESOLVED (got ${invalid.join(', ')})`);
  }
  const statuses = values as AlertGroupStatus[];
  return statuses.length === 1 ? statuses[0] : statuses;
}

function formatAlertGroupLine(group: AlertGroup): string {
  const title = group.hostname || group.id;
  const types = group.alertTypes?.length ? ` - Types: ${group.alertTypes.join(', ')}` : '';
  return (
    `• ${title} (${group.id})` +
    (group.status ? ` - Status: ${group.status}` : '') +
    (group.alertCount !== undefined ? ` - Alerts: ${group.alertCount}` : '') +
    types +
    (group.username ? ` - User: ${group.username}` : '') +
    (group.type ? ` - Type: ${group.type}` : '')
  );
}

function getTools(): Tool[] {
  return [
    {
      name: 'blackpoint_detections_list',
      description:
        'List alert groups for a tenant (CompassOne removed GET /detections; groups are the triage unit). Paged with skip/take. status is OPEN or RESOLVED. tenantId is sent as the x-tenant-id header.',
      inputSchema: {
        type: 'object',
        properties: {
          tenantId: {
            type: 'string',
            description: 'Tenant ID. Required. Sent as the x-tenant-id header.',
          },
          status: {
            type: 'string',
            enum: [...ALERT_GROUP_STATUSES],
            description: 'Alert group status: OPEN or RESOLVED',
          },
          skip: {
            type: 'number',
            description: 'Number of alert groups to skip',
            minimum: 0,
          },
          take: {
            type: 'number',
            description: 'Number of alert groups to return',
            minimum: 1,
            maximum: 100,
          },
          search: {
            type: 'string',
            description: 'Search alert groups',
          },
          since: {
            type: 'string',
            description: 'ISO-8601 instant. CompassOne allows at most 90 days back.',
          },
        },
        required: ['tenantId'],
      },
    },
    {
      name: 'blackpoint_detections_get',
      description:
        'Get one alert group by id. tenantId is required and is sent as the x-tenant-id header. Reads GET /alert-groups/{id}.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Alert group ID',
          },
          tenantId: {
            type: 'string',
            description: 'Tenant ID. Required. Sent as the x-tenant-id header.',
          },
        },
        required: ['id', 'tenantId'],
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
    case 'blackpoint_detections_list': {
      try {
        const params: AlertGroupListParams = {
          tenantId: args.tenantId as string,
        };
        if (args.skip !== undefined) params.skip = Number(args.skip);
        if (args.take !== undefined) params.take = Number(args.take);
        if (args.search !== undefined) params.search = String(args.search);
        if (args.since !== undefined) params.since = String(args.since);
        const status = readStatus(args.status);
        if (status !== undefined) params.status = status;

        const response = await client.alertGroups.list(params);
        const { items, pagination } = pageItems(response);
        const pageLabel = formatPagination(pagination);

        const summary = [`Found ${items.length} alert groups`, pageLabel].filter(Boolean).join(' ');

        const resultText = [summary, '', ...items.map(formatAlertGroupLine)].join('\n');

        return {
          content: [{ type: 'text', text: resultText }],
        };
      } catch (error) {
        return toolFailure('Failed to list detections', error);
      }
    }

    case 'blackpoint_detections_get': {
      const id = args.id as string;
      const tenantId = args.tenantId as string;

      try {
        const group = await client.alertGroups.get(id, { tenantId });
        const types = group.alertTypes?.length ? group.alertTypes.join(', ') : null;

        const details = [
          `Alert group: ${group.hostname || group.id} (${group.id})`,
          group.status ? `Status: ${group.status}` : null,
          group.alertCount !== undefined ? `Alerts: ${group.alertCount}` : null,
          types ? `Types: ${types}` : null,
          group.hostname ? `Host: ${group.hostname}` : null,
          group.username ? `User: ${group.username}` : null,
          group.type ? `Type: ${group.type}` : null,
          group.tenantId ? `Tenant: ${group.tenantId}` : null,
          group.created ? `Created: ${group.created}` : null,
        ]
          .filter(Boolean)
          .join('\n');

        return {
          content: [{ type: 'text', text: details }],
        };
      } catch (error) {
        return toolFailure(`Failed to get detection ${id}`, error, { id });
      }
    }

    default:
      return {
        content: [{ type: 'text', text: `Unknown detections tool: ${toolName}` }],
        isError: true,
      };
  }
}

export const detectionsHandler: DomainHandler = { getTools, handleCall };
