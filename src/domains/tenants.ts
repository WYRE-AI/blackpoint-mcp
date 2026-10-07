import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { DomainHandler, CallToolResult, RequestHandlerExtra } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { formatPagination, pageItems } from '../utils/format-pagination.js';
import { toolFailure } from '../utils/service-error.js';

function getTools(): Tool[] {
  return [
    {
      name: 'blackpoint_tenants_list',
      description: 'List customer tenants under the current partner account',
      inputSchema: {
        type: 'object',
        properties: {
          accountId: {
            type: 'string',
            description: 'Filter by specific account ID',
          },
          status: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['active', 'inactive', 'suspended'],
            },
            description: 'Filter by tenant status',
          },
          search: {
            type: 'string',
            description: 'Search tenants by name',
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
      name: 'blackpoint_tenants_get',
      description: 'Get detailed information about a specific tenant',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Tenant ID',
          },
        },
        required: ['id'],
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
    case 'blackpoint_tenants_list': {
      const params = {
        accountId: args.accountId as string | undefined,
        status: args.status as string[] | undefined,
        search: args.search as string | undefined,
        page: args.page as number | undefined,
        pageSize: args.pageSize as number | undefined,
      };

      try {
        const response = await client.tenants.list(params);
        const { items, pagination } = pageItems(response);
        const pageLabel = formatPagination(pagination);

        const summary = [`Found ${items.length} tenants`, pageLabel].filter(Boolean).join(' ');

        const resultText = [
          summary,
          '',
          ...items.map((tenant: any) =>
            `• ${tenant.name} (${tenant.id})` +
            (tenant.status ? ` - Status: ${tenant.status}` : '') +
            (tenant.accountId ? ` - Account: ${tenant.accountId}` : '') +
            (tenant.created ? ` - Created: ${tenant.created}` : '')
          ),
        ].join('\n');

        return {
          content: [{ type: 'text', text: resultText }],
        };
      } catch (error) {
        return toolFailure('Failed to list tenants', error);
      }
    }

    case 'blackpoint_tenants_get': {
      const id = args.id as string;

      try {
        const tenant = await client.tenants.get(id);

        const tenantDetails = [
          `Tenant: ${tenant.name} (${tenant.id})`,
          `Status: ${tenant.status}`,
          tenant.accountId ? `Account: ${tenant.accountId}` : null,
          tenant.description ? `Description: ${tenant.description}` : null,
          tenant.created ? `Created: ${tenant.created}` : null,
          tenant.updated ? `Updated: ${tenant.updated}` : null,
        ].filter(Boolean).join('\n');

        return {
          content: [{ type: 'text', text: tenantDetails }],
        };
      } catch (error) {
        return toolFailure(`Failed to get tenant ${id}`, error, { id });
      }
    }

    default:
      return {
        content: [{ type: 'text', text: `Unknown tenants tool: ${toolName}` }],
        isError: true,
      };
  }
}

export const tenantsHandler: DomainHandler = { getTools, handleCall };