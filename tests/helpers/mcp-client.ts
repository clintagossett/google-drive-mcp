/**
 * MCP Client Test Helper
 *
 * Provides utilities for testing MCP server tools
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface MCPClientConfig {
  serverPath: string;
  env?: Record<string, string>;
}

/**
 * Creates and connects an MCP client to the server
 */
export async function createMCPClient(config: MCPClientConfig): Promise<{ client: Client; transport: StdioClientTransport }> {
  const transport = new StdioClientTransport({
    command: 'node',
    args: [config.serverPath],
    env: {
      ...process.env,
      ...config.env,
    },
  });

  const client = new Client(
    {
      name: 'vitest-client',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  await client.connect(transport);

  return { client, transport };
}

/**
 * Closes MCP client connection
 */
export async function closeMCPClient(client: Client): Promise<void> {
  await client.close();
}

/**
 * Calls an MCP tool and returns the result
 */
export async function callTool(
  client: Client,
  toolName: string,
  args: Record<string, any>
): Promise<any> {
  return await client.callTool({
    name: toolName,
    arguments: args,
  });
}

/**
 * Lists all available tools
 */
export async function listTools(client: Client): Promise<string[]> {
  const response = await client.listTools();
  return response.tools.map((t) => t.name);
}
