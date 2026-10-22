import 'server-only';

import { McpToolError } from '../../errors';
import { defineTool } from '../../registry';
import { hasScope } from '../../scopes';

/**
 * The first tool every client calls: who it is acting as, in which team,
 * with which scopes, and what that means for generation. `mode.generation`
 * is `'external'` for every MCP call and is reported, not chosen.
 * `serverTools` counts what the server lists: a client keeps the tool list
 * from when it connected, and whoami is in every such list (FILM-2213).
 */
export const whoamiTool = defineTool({
  name: 'whoami',
  title: 'Who am I',
  description:
    'The user and team this connection acts as, the scopes it holds, and the generation mode (always external over MCP).',
  inputSchema: {},
  scope: null,
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  async handler(_input, context) {
    const { principal, accountId } = context;

    const [{ data: user, error: userError }, { data: team, error: teamError }] =
      await Promise.all([
        principal.supabase
          .from('accounts')
          .select('id, name, email')
          .eq('id', principal.userId)
          .maybeSingle(),
        principal.supabase
          .from('accounts')
          .select('id, name, slug')
          .eq('id', accountId)
          .maybeSingle(),
      ]);

    if (userError || teamError) {
      throw new McpToolError(
        'INTERNAL',
        'Could not read the user or team record.',
      );
    }

    if (!team) {
      throw new McpToolError('FORBIDDEN', 'The team is not visible to you.');
    }

    const names = context.serverToolNames;
    const serverTools = names
      ? { count: names.length, names: [...names] }
      : undefined;

    return {
      ...(serverTools && {
        text: `This server has ${serverTools.count} tools. If your tool list has fewer, disconnect and reconnect StoryBook in your client's connector settings, then start a new chat: a client keeps the tool list from when it connected.`,
      }),
      structuredContent: {
        user: {
          id: principal.userId,
          name: user?.name ?? null,
          email: user?.email ?? null,
        },
        team: { id: team.id, slug: team.slug, name: team.name },
        connection: {
          id: principal.connectionId,
          clientName: principal.clientName,
          scopes: principal.scopes,
        },
        mode: {
          generation: 'external',
          canRead: hasScope(principal.scopes, 'studio:read'),
          canWrite: hasScope(principal.scopes, 'studio:write'),
          canRender: hasScope(principal.scopes, 'studio:render'),
          canSchedulePublishes: hasScope(principal.scopes, 'studio:publish'),
        },
        ...(serverTools && { serverTools }),
      },
    };
  },
});
