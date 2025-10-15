# @kit/mcp-server

![Complexity: Simple](https://img.shields.io/badge/complexity-simple-green)

## Overview

The `@kit/mcp-server` package provides a Model Context Protocol (MCP) server that enables AI agents to interact with the Makerkit codebase. It exposes tools and resources for code analysis, database operations, component discovery, and development workflows.

## Purpose

This package serves as an AI-powered development assistant, providing:

- **Codebase exploration**: Tools for discovering and analyzing code structure
- **Database operations**: Direct database access and migration management
- **Component discovery**: UI component and pattern identification
- **Development scripts**: Access to build and development tools
- **Prompt management**: AI-specific prompts and templates
- **Resource access**: Direct access to codebase resources

## Technology Stack

- **MCP SDK**: Model Context Protocol server implementation
- **TypeScript**: Full type safety and modern JavaScript features
- **Zod**: Schema validation for tool inputs
- **PostgreSQL**: Database connectivity and operations
- **Node.js**: Server runtime environment

## Installation

```bash
pnpm add @kit/mcp-server
```

## Configuration

### Environment Variables

```bash
# Database connection
DATABASE_URL=postgresql://user:password@localhost:5432/database

# Optional: Custom paths
COMPONENTS_PATH=packages/ui/src/components
SCRIPTS_PATH=scripts
MIGRATIONS_PATH=apps/web/supabase/migrations
```

### MCP Client Setup

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "makerkit": {
      "command": "node",
      "args": ["./node_modules/@kit/mcp-server/build/index.js"],
      "env": {
        "DATABASE_URL": "your_database_url"
      }
    }
  }
}
```

## Available Tools

### Component Tools

#### `get_components`

Discover and list UI components in the codebase.

```typescript
// Usage example
const components = await mcpClient.callTool('get_components', {
  pattern: '**/*.tsx',
  includeProps: true,
});
```

**Parameters:**

- `pattern?: string` - Glob pattern for component discovery
- `includeProps?: boolean` - Include component prop definitions
- `includeExamples?: boolean` - Include usage examples

### Database Tools

#### `execute_sql`

Execute SQL queries against the database.

```typescript
// Usage example
const result = await mcpClient.callTool('execute_sql', {
  query: 'SELECT * FROM users LIMIT 10',
  readonly: true,
});
```

**Parameters:**

- `query: string` - SQL query to execute
- `readonly?: boolean` - Restrict to read-only operations
- `params?: any[]` - Query parameters for prepared statements

#### `get_schema`

Retrieve database schema information.

```typescript
const schema = await mcpClient.callTool('get_schema', {
  table: 'users',
  includeIndexes: true,
});
```

### Migration Tools

#### `get_migrations`

List and analyze database migrations.

```typescript
const migrations = await mcpClient.callTool('get_migrations', {
  status: 'pending',
  includeContent: true,
});
```

#### `create_migration`

Generate new database migration files.

```typescript
const migration = await mcpClient.callTool('create_migration', {
  name: 'add_user_preferences',
  description: 'Add user preferences table',
});
```

### Script Tools

#### `run_script`

Execute development scripts.

```typescript
const result = await mcpClient.callTool('run_script', {
  script: 'build',
  target: 'web',
  args: ['--production'],
});
```

#### `list_scripts`

Discover available scripts in the project.

```typescript
const scripts = await mcpClient.callTool('list_scripts', {
  category: 'build',
});
```

### Prompt Tools

#### `get_prompt`

Retrieve AI-specific prompts and templates.

```typescript
const prompt = await mcpClient.callTool('get_prompt', {
  name: 'code_review',
  context: { language: 'typescript' },
});
```

## Available Resources

### Database Resources

- **Schema definitions**: Access to table schemas and relationships
- **Migration history**: Complete migration timeline and status
- **Data samples**: Representative data for analysis

### Code Resources

- **Component catalog**: Searchable component library
- **Type definitions**: TypeScript interfaces and types
- **Configuration files**: Build and deployment configurations

## Usage Examples

### Code Analysis

```typescript
// Discover all form components
const formComponents = await mcpClient.callTool('get_components', {
  pattern: '**/form/**/*.tsx',
  includeProps: true,
});

// Analyze component usage patterns
formComponents.forEach((component) => {
  console.log(`${component.name}: ${component.props.length} props`);
});
```

### Database Operations

```typescript
// Get user statistics
const stats = await mcpClient.callTool('execute_sql', {
  query: `
    SELECT
      COUNT(*) as total_users,
      COUNT(CASE WHEN created_at > NOW() - INTERVAL '30 days' THEN 1 END) as recent_users
    FROM users
  `,
  readonly: true,
});

// Check migration status
const migrations = await mcpClient.callTool('get_migrations', {
  status: 'all',
});
```

### Development Workflow

```typescript
// Run tests before deployment
const testResult = await mcpClient.callTool('run_script', {
  script: 'test',
  target: 'web',
});

if (testResult.success) {
  // Deploy if tests pass
  await mcpClient.callTool('run_script', {
    script: 'deploy',
    target: 'production',
  });
}
```

## Available Scripts

### Development

```bash
# Build the MCP server
pnpm --filter @kit/mcp-server build

# Watch for changes during development
pnpm --filter @kit/mcp-server build:watch

# Run the MCP server directly
pnpm --filter @kit/mcp-server mcp

# Format code
pnpm --filter @kit/mcp-server format
```

## Package Structure

```
packages/mcp-server/
├── src/
│   ├── tools/
│   │   ├── components.ts    # Component discovery tools
│   │   ├── database.ts      # Database operation tools
│   │   ├── migrations.ts    # Migration management tools
│   │   ├── prompts.ts       # AI prompt management
│   │   └── scripts.ts       # Development script tools
│   └── index.ts             # MCP server entry point
├── build/                   # Compiled JavaScript output
├── package.json
├── tsconfig.json
└── README.md
```

## Dependencies

### Required Packages

- `@modelcontextprotocol/sdk` - MCP protocol implementation
- `zod` - Schema validation
- `postgres` - PostgreSQL client
- `@types/node` - Node.js type definitions

### Development Dependencies

- `@kit/eslint-config` - ESLint configuration
- `@kit/prettier-config` - Prettier configuration
- `@kit/tsconfig` - TypeScript configuration

## Security Considerations

### Database Access

- **Read-only by default**: Most operations are read-only unless explicitly allowed
- **Parameter validation**: All inputs are validated using Zod schemas
- **Connection limits**: Database connections are pooled and limited

### Tool Permissions

- **Script execution**: Limited to predefined scripts in the project
- **File access**: Restricted to project directories only
- **Environment isolation**: No access to system-level operations

## Integration with AI Agents

### Claude Desktop

```json
{
  "mcpServers": {
    "makerkit": {
      "command": "node",
      "args": ["path/to/makerkit-mcp-server/build/index.js"]
    }
  }
}
```

### Custom MCP Clients

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'node',
  args: ['./node_modules/@kit/mcp-server/build/index.js'],
});

const client = new Client(
  {
    name: 'makerkit-client',
    version: '1.0.0',
  },
  {
    capabilities: {},
  },
);

await client.connect(transport);
```

## Troubleshooting

### Common Issues

**Server not starting:**

- Check that the build directory exists: `pnpm build`
- Verify Node.js version compatibility (Node 18+)
- Ensure all dependencies are installed

**Database connection errors:**

- Verify `DATABASE_URL` environment variable
- Check database server accessibility
- Confirm connection string format

**Tool execution failures:**

- Check input parameter validation
- Verify file system permissions
- Review server logs for detailed errors

### Debug Mode

Enable debug logging:

```bash
DEBUG=mcp* node build/index.js
```

## Contributing

When contributing to this package:

1. **Follow MCP patterns**: Use established MCP SDK conventions
2. **Validate inputs**: Use Zod schemas for all tool parameters
3. **Handle errors gracefully**: Provide clear error messages
4. **Document tools**: Add comprehensive JSDoc for all tools
5. **Test with real agents**: Verify functionality with actual MCP clients
6. **Security first**: Consider security implications of new tools

### Adding New Tools

1. **Create tool file** in `src/tools/`
2. **Define Zod schemas** for parameters
3. **Implement tool handler**
4. **Register in main server**
5. **Add documentation**
6. **Test with MCP client**

---

_Last updated: September 20, 2025_
