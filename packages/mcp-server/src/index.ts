import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerComponentsTools } from './tools/components';
import {
  registerDatabaseResources,
  registerDatabaseTools,
} from './tools/database';
import { registerGetMigrationsTools } from './tools/migrations';
import { registerPromptsSystem } from './tools/prompts';
import { registerScriptsTools } from './tools/scripts';

async function main() {
  // Create server instance
  const server = new McpServer({
    name: 'makerkit',
    version: '1.0.0',
  });

  const transport = new StdioServerTransport();

  registerGetMigrationsTools(server);
  registerDatabaseTools(server);
  registerDatabaseResources(server);
  registerComponentsTools(server);
  registerScriptsTools(server);
  registerPromptsSystem(server);

  await server.connect(transport);

  console.error('Makerkit MCP Server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
