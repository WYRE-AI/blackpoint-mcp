import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import {
  ASSET_CLASSES,
  type AssetClass,
  type AssetListParams,
  type AssetRelationshipDirection,
  type AssetRelationshipListParams,
} from '@wyre-ai/node-blackpoint';
import type { DomainHandler, CallToolResult, RequestHandlerExtra } from '../utils/types.js';
import { getClient } from '../utils/client.js';
import { formatPagination, pageItems, type PaginationLike } from '../utils/format-pagination.js';
import { toolFailure } from '../utils/service-error.js';

const ASSET_CLASS_ENUM = [...ASSET_CLASSES];

function getTools(): Tool[] {
  return [
    {
      name: 'blackpoint_assets_list',
      description:
        'List assets for one tenant. class is required (CONTAINER, DEVICE, FRAMEWORK, NETSTAT, PERSON, PROCESS, SERVICE, SOFTWARE, SOURCE, SURVEY, USER). tenantId is sent as the x-tenant-id header. CLOUD is not an asset class.',
      inputSchema: {
        type: 'object',
        properties: {
          class: {
            type: 'string',
            enum: ASSET_CLASS_ENUM,
            description: 'Asset class to list (required). Sent as the class query parameter.',
          },
          tenantId: {
            type: 'string',
            description: 'Tenant ID. Required. Sent as the x-tenant-id header, not as a query parameter.',
          },
          search: {
            type: 'string',
            description: 'Search assets by name or description',
          },
          status: {
            type: 'string',
            enum: ['active', 'inactive', 'decommissioned'],
            description: 'Filter by asset status',
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
        required: ['class', 'tenantId'],
      },
    },
    {
      name: 'blackpoint_assets_get',
      description:
        'Get one asset by id. tenantId is required and is sent as the x-tenant-id header.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'Asset ID',
          },
          tenantId: {
            type: 'string',
            description: 'Tenant ID. Required. Sent as the x-tenant-id header.',
          },
        },
        required: ['id', 'tenantId'],
      },
    },
    {
      name: 'blackpoint_assets_relationships',
      description:
        'List relationships for an asset. direction is in (the other entity points at this asset) or out (this asset points at the other entity). class is the far-side asset class and is sent as entityClass. tenantId is sent as x-tenant-id.',
      inputSchema: {
        type: 'object',
        properties: {
          assetId: {
            type: 'string',
            description: 'Source asset ID',
          },
          class: {
            type: 'string',
            enum: ASSET_CLASS_ENUM,
            description: 'Far-side asset class. Sent as the entityClass query parameter.',
          },
          direction: {
            type: 'string',
            enum: ['in', 'out'],
            description: 'Relationship direction: in or out',
          },
          tenantId: {
            type: 'string',
            description: 'Tenant ID. Required. Sent as the x-tenant-id header.',
          },
        },
        required: ['assetId', 'class', 'direction', 'tenantId'],
      },
    },
    {
      name: 'blackpoint_assets_search',
      description:
        'Search assets in one tenant. Issues one list call per class (all documented classes when classes is omitted). tenantId is sent as x-tenant-id on every call.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search query (asset name, description, etc.)',
          },
          tenantId: {
            type: 'string',
            description: 'Tenant ID. Required. Sent as the x-tenant-id header.',
          },
          classes: {
            type: 'array',
            items: {
              type: 'string',
              enum: ASSET_CLASS_ENUM,
            },
            description: 'Asset classes to search. Defaults to every documented class.',
          },
          tenantIds: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional extra filter applied to the returned assets after the tenant-scoped list.',
          },
        },
        required: ['query', 'tenantId'],
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
    case 'blackpoint_assets_list': {
      const params: AssetListParams = {
        class: args.class as AssetClass,
        search: args.search as string | undefined,
        page: args.page as number | undefined,
        pageSize: args.pageSize as number | undefined,
        tenantId: args.tenantId as string,
      };

      try {
        const response = await client.assets.list(params);
        const { items, pagination } = pageItems(response);
        const pageLabel = formatPagination(pagination);

        const summary = [`Found ${items.length} ${params.class} assets`, pageLabel]
          .filter(Boolean)
          .join(' ');

        const resultText = [
          summary,
          '',
          ...items.map(
            asset =>
              `• ${asset.displayName || asset.name} (${asset.id})` +
              (asset.tenantId ? ` - Tenant: ${asset.tenantId}` : '') +
              (asset.status ? ` - Status: ${asset.status}` : '') +
              (asset.lastSeenOn ? ` - Last seen: ${asset.lastSeenOn}` : '')
          ),
        ].join('\n');

        return {
          content: [{ type: 'text', text: resultText }],
        };
      } catch (error) {
        return toolFailure('Failed to list assets', error);
      }
    }

    case 'blackpoint_assets_get': {
      const id = args.id as string;
      const tenantId = args.tenantId as string;

      try {
        const asset = await client.assets.get(id, { tenantId });

        const assetDetails = [
          `Asset: ${asset.displayName || asset.name} (${asset.id})`,
          `Class: ${asset.assetClass}`,
          `Status: ${asset.status}`,
          asset.tenantId ? `Tenant: ${asset.tenantId}` : null,
          asset.description ? `Description: ${asset.description}` : null,
          asset.lastSeenOn ? `Last seen: ${asset.lastSeenOn}` : null,
          asset.foundBy ? `Found by: ${asset.foundBy}` : null,
          asset.foundOn ? `Found on: ${asset.foundOn}` : null,
          asset.criticality ? `Criticality: ${asset.criticality}` : null,
          asset.classification ? `Classification: ${asset.classification}` : null,
        ]
          .filter(Boolean)
          .join('\n');

        return {
          content: [{ type: 'text', text: assetDetails }],
        };
      } catch (error) {
        return toolFailure(`Failed to get asset ${id}`, error, { id });
      }
    }

    case 'blackpoint_assets_relationships': {
      const assetId = args.assetId as string;
      const params: AssetRelationshipListParams = {
        class: args.class as AssetClass,
        direction: args.direction as AssetRelationshipDirection,
        tenantId: args.tenantId as string,
      };

      try {
        const response = await client.assets.listRelationships(assetId, params);
        const { items } = pageItems(response);
        const directionLabel = params.direction.charAt(0).toUpperCase() + params.direction.slice(1);

        const resultText = [
          `${directionLabel} relationships for asset ${assetId}:`,
          '',
          ...items.map(
            rel =>
              `• ${rel.relationshipType}: ${rel.targetAssetId} (created ${rel.created || 'unknown'})`
          ),
        ].join('\n');

        return {
          content: [{ type: 'text', text: resultText }],
        };
      } catch (error) {
        return toolFailure(`Failed to list relationships for asset ${assetId}`, error, { assetId });
      }
    }

    case 'blackpoint_assets_search': {
      const query = args.query as string;
      const classes = args.classes as string[] | undefined;
      const tenantIds = args.tenantIds as string[] | undefined;
      const tenantId = args.tenantId as string;
      const searchClasses = (classes && classes.length > 0 ? classes : ASSET_CLASS_ENUM) as AssetClass[];

      try {
        const perClass = await mapWithConcurrency(searchClasses, SEARCH_CONCURRENCY, assetClass =>
          searchAssetClass(client, assetClass, query, tenantId)
        );
        const allResults: SearchHit[] = perClass.flatMap(result => result.items);
        const truncated = perClass
          .map((result, i) => ({ ...result, assetClass: searchClasses[i] }))
          .filter(result => result.truncated);

        const filteredResults = tenantIds
          ? allResults.filter(asset => asset.tenantId !== undefined && tenantIds.includes(asset.tenantId))
          : allResults;

        const resultText = [
          `Search results for "${query}":`,
          `Found ${filteredResults.length} assets across ${searchClasses.join(', ')} classes`,
          ...(truncated.length > 0
            ? [
                `Results truncated: stopped after ${SEARCH_MAX_PAGES * SEARCH_PAGE_SIZE} assets per class for ` +
                  truncated
                    .map(
                      result =>
                        result.totalCount !== undefined
                          ? `${result.assetClass} (${result.totalCount} matches)`
                          : result.assetClass
                    )
                    .join(', ') +
                  '. Narrow the query or search fewer classes to see the rest.',
              ]
            : []),
          '',
          ...filteredResults.map(
            asset =>
              `• ${asset.displayName || asset.name} (${asset.assetClass}) - ${asset.id}` +
              (asset.tenantId ? ` - Tenant: ${asset.tenantId}` : '')
          ),
        ].join('\n');

        return {
          content: [{ type: 'text', text: resultText }],
        };
      } catch (error) {
        return toolFailure('Failed to search assets', error, { query });
      }
    }

    default:
      return {
        content: [{ type: 'text', text: `Unknown assets tool: ${toolName}` }],
        isError: true,
      };
  }
}

interface SearchHit {
  id: string;
  displayName?: string;
  name?: string;
  assetClass?: string;
  tenantId?: string;
}

/** Largest page the asset list route accepts (matches the list tool's schema). */
export const SEARCH_PAGE_SIZE = 100;
/** Pages fetched per class before the search reports truncation. */
export const SEARCH_MAX_PAGES = 5;
/**
 * Classes searched at once. The SDK's token bucket still meters every call
 * against the key quota; this only bounds how many are in flight.
 */
export const SEARCH_CONCURRENCY = 3;

type AssetsClient = Awaited<ReturnType<typeof getClient>>;

/**
 * Page through one class until the API reports no more results or
 * SEARCH_MAX_PAGES is reached. `truncated` is true when results remain.
 */
async function searchAssetClass(
  client: AssetsClient,
  assetClass: AssetClass,
  query: string,
  tenantId: string
): Promise<{ items: SearchHit[]; truncated: boolean; totalCount?: number }> {
  const items: SearchHit[] = [];
  let totalCount: number | undefined;
  for (let page = 1; page <= SEARCH_MAX_PAGES; page++) {
    const response = await client.assets.list({
      class: assetClass,
      search: query,
      tenantId,
      page,
      pageSize: SEARCH_PAGE_SIZE,
    });
    const { items: pageHits, pagination } = pageItems(response);
    items.push(...pageHits);
    if (pagination?.totalCount !== undefined) totalCount = pagination.totalCount;

    const more = hasMorePages(pagination, page, pageHits.length, items.length);
    if (!more) return { items, truncated: false, totalCount };
    if (page === SEARCH_MAX_PAGES) return { items, truncated: true, totalCount };
  }
  return { items, truncated: false, totalCount };
}

function hasMorePages(
  pagination: (PaginationLike & { hasNext?: boolean }) | null,
  page: number,
  pageLength: number,
  fetched: number
): boolean {
  if (pageLength === 0) return false;
  if (pagination?.hasNext !== undefined) return pagination.hasNext;
  if (pagination?.totalPages !== undefined) return page < pagination.totalPages;
  if (pagination?.totalCount !== undefined) return fetched < pagination.totalCount;
  // No metadata: a full page means there may be another one.
  return pageLength >= SEARCH_PAGE_SIZE;
}

/** Run `fn` over `inputs` with at most `limit` in flight; results keep input order. */
async function mapWithConcurrency<T, R>(
  inputs: readonly T[],
  limit: number,
  fn: (input: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(inputs.length);
  let next = 0;
  const worker = async () => {
    while (next < inputs.length) {
      const i = next++;
      results[i] = await fn(inputs[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, inputs.length) }, worker));
  return results;
}

export const assetsHandler: DomainHandler = { getTools, handleCall };
