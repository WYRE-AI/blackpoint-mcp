import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getAllTools, getHandlerForTool } from './domains/index.js';
import { logger } from './utils/logger.js';
import { setServerRef } from './utils/server-ref.js';

export function createMcpServer(): Server {
  const server = new Server(
    {
      name: 'blackpoint-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Set server reference for elicitation
  setServerRef(server);

  // List tools handler
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = getAllTools();

    logger.info('Tools listed', { count: tools.length, toolNames: tools.map(t => t.name) });

    return { tools };
  });

  // Call tool handler
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    logger.info('Tool called', { name, args });

    try {
      const handler = getHandlerForTool(name);
      if (!handler) {
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
      }

      // MCP SDK's CallToolRequest doesn't expose a JSON-RPC `id` to handlers
      // (the envelope is stripped). RequestHandlerExtra.requestId is optional;
      // omit it rather than fabricate one.
      const result = await handler.handleCall(name, args || {}, {
        meta: { serverName: 'blackpoint-mcp' },
      });

      logger.info('Tool call completed', { name, success: !result.isError });

      return result;
    } catch (error) {
      logger.error('Tool call failed', { name, error });

      return {
        content: [
          {
            type: 'text',
            text: `Tool call failed: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}

export async function runStdioServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();

  logger.info('Starting Blackpoint MCP server...');

  await server.connect(transport);

  logger.info('Blackpoint MCP server running on stdio');
}