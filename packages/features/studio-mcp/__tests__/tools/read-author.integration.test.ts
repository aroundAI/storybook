import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { generatePersonalAccessToken, hashToken } from '../../src/server/token';

/**
 * FILM-1905 integration: the read and author tools through the SDK client,
 * with a seeded team, a second team the token must not see, and a personal
 * access token, against a local Supabase.
 *
 *   MCP_INTEGRATION=1 E2E_SUPABASE_URL=http://127.0.0.1:55421 \
 *     pnpm --filter @kit/studio-mcp test read-author.integration
 *
 * By default the route handlers run in-process (the SDK client's `fetch` is
 * pointed at `createMcpRouteHandlers().POST`), so the whole stack from
 * bearer token to RLS runs without a dev server. Set MCP_INTEGRATION_URL
 * (for example http://localhost:3212/api/mcp) to drive a running server
 * instead. Skipped without MCP_INTEGRATION, so the unit run needs no database.
 *
 * Seeding goes through the Supabase REST API as apps/e2e/tests/utils/seed.ts
 * does: admin user creation, `create_team_account` as the user, then the
 * rows the tools will read, written as the owner so RLS has had its say.
 */
const ENABLED = process.env.MCP_INTEGRATION === '1';
const SUPABASE_URL =
  process.env.E2E_SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  'http://127.0.0.1:55321';
const ANON_KEY =
  process.env.E2E_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SERVICE_ROLE_KEY =
  process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const JWT_SECRET =
  process.env.SUPABASE_JWT_SECRET ??
  'super-secret-jwt-token-with-at-least-32-characters-long';

async function rest(
  path: string,
  init: { method?: string; body?: unknown; token?: string; prefer?: string },
) {
  const response = await fetch(`${SUPABASE_URL}${path}`, {
    method: init.method ?? 'POST',
    headers: {
      apikey: init.token === SERVICE_ROLE_KEY ? SERVICE_ROLE_KEY : ANON_KEY,
      Authorization: `Bearer ${init.token ?? ANON_KEY}`,
      'Content-Type': 'application/json',
      ...(init.prefer ? { Prefer: init.prefer } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `${init.method ?? 'POST'} ${path} → ${response.status}: ${text}`,
    );
  }

  return text ? JSON.parse(text) : null;
}

interface Team {
  userId: string;
  token: string;
  accountId: string;
  slug: string;
  projectId: string;
  episodeId: string;
}

async function seedTeam(label: string): Promise<Team> {
  const stamp = randomUUID();
  const email = `mcp-${label}-${stamp}@makerkit.dev`;

  await rest('/auth/v1/admin/users', {
    token: SERVICE_ROLE_KEY,
    body: { email, password: 'password', email_confirm: true },
  });

  const session = await rest('/auth/v1/token?grant_type=password', {
    body: { email, password: 'password' },
  });
  const token = session.access_token as string;

  const account = await rest('/rest/v1/rpc/create_team_account', {
    token,
    body: { account_name: `MCP ${label} ${stamp.slice(0, 8)}` },
  });

  const [project] = await rest('/rest/v1/projects', {
    token,
    prefer: 'return=representation',
    body: {
      account_id: account.id,
      name: `Series ${label}`,
      slug: `series-${label}-${stamp.slice(0, 8)}`,
      metadata: { genre: 'drama', contentStyle: 'balanced' },
    },
  });

  const [episode] = await rest('/rest/v1/episodes', {
    token,
    prefer: 'return=representation',
    body: {
      project_id: project.id,
      number: 1,
      title: `Pilot ${label}`,
      slug: `episode-1-pilot-${label}`,
      status: 'story',
      version: 1,
      metadata: {},
      story_data: {
        logline: `The ${label} pilot`,
        fullStory: 'Once upon a time.',
      },
      screenplay_data: {
        scenes: [
          {
            number: 1,
            heading: 'INT. HALL - DAY',
            location: 'Hall',
            timeOfDay: 'day',
            description: 'Open.',
            dialogue: [{ character: 'Ada', text: 'Hello.' }],
            estimatedDuration: 20,
          },
          {
            number: 2,
            heading: 'EXT. PIER - DUSK',
            location: 'Pier',
            timeOfDay: 'dusk',
            description: 'Close.',
            dialogue: [],
            estimatedDuration: 30,
          },
          {
            number: 3,
            heading: 'INT. HALL - NIGHT',
            location: 'Hall',
            timeOfDay: 'night',
            description: 'End.',
            dialogue: [],
            estimatedDuration: 10,
          },
        ],
        metadata: {
          totalScenes: 3,
          estimatedDuration: 60,
          locations: ['Hall', 'Pier'],
          characters: ['Ada'],
        },
      },
    },
  });

  return {
    userId: session.user.id as string,
    token,
    accountId: account.id as string,
    slug: account.slug as string,
    projectId: project.id as string,
    episodeId: episode.id as string,
  };
}

async function mintPat(team: Team, scopes: string[]) {
  const pat = generatePersonalAccessToken();

  await rest('/rest/v1/rpc/create_mcp_personal_access_token', {
    token: team.token,
    body: {
      p_account_id: team.accountId,
      p_name: 'integration test',
      p_scopes: scopes,
      p_token_hash: hashToken(pat),
    },
  });

  return pat;
}

type CallResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type: string; text?: string }>;
};

describe.skipIf(!ENABLED)('FILM-1905 read and author tools over MCP', () => {
  let teamA: Team;
  let teamB: Team;
  let deletedEpisodeId: string;
  let client: Client;
  let connectWith: (pat: string) => Promise<Client>;

  beforeAll(async () => {
    [teamA, teamB] = await Promise.all([seedTeam('a'), seedTeam('b')]);

    const [deleted] = await rest('/rest/v1/episodes', {
      token: teamA.token,
      prefer: 'return=representation',
      body: {
        project_id: teamA.projectId,
        number: 2,
        title: 'Deleted one',
        slug: 'episode-2-deleted-one',
        status: 'draft',
        version: 1,
        metadata: {},
        deleted_at: new Date().toISOString(),
      },
    });
    deletedEpisodeId = deleted.id as string;

    const url = process.env.MCP_INTEGRATION_URL;
    let fetchImpl: typeof fetch | undefined;

    if (!url) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
      process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;
      process.env.SUPABASE_JWT_SECRET = JWT_SECRET;
      process.env.CACHE_PROVIDER = 'memory';
      process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3212';

      const { createMcpRouteHandlers } = await import(
        '../../src/server/route-handler'
      );
      const handlers = createMcpRouteHandlers();

      fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init);

        if (request.method === 'POST') return handlers.POST(request);
        if (request.method === 'DELETE') return handlers.DELETE(request);

        return handlers.GET(request);
      }) as typeof fetch;
    }

    connectWith = async (pat: string) => {
      const transport = new StreamableHTTPClientTransport(
        new URL(url ?? 'http://localhost:3212/api/mcp'),
        {
          requestInit: { headers: { Authorization: `Bearer ${pat}` } },
          ...(fetchImpl ? { fetch: fetchImpl } : {}),
        },
      );
      const c = new Client({ name: 'film-1905-integration', version: '0' });
      await c.connect(transport);

      return c;
    };

    client = await connectWith(
      await mintPat(teamA, ['studio:read', 'studio:write']),
    );
  }, 60_000);

  afterAll(async () => {
    await client?.close();
  });

  const call = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args }) as Promise<CallResult>;

  it('lists the fifteen tools and offers the workflow guide as a prompt too', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((tool) => tool.name).sort();

    expect(names).toEqual(
      [
        'whoami',
        'get_workflow_guide',
        'list_projects',
        'get_project',
        'list_episodes',
        'get_episode',
        'get_screenplay',
        'get_shots',
        'get_dialogue',
        'list_assets',
        'create_project',
        'update_project',
        'create_episode',
        'update_episode',
        'upsert_asset',
      ].sort(),
    );

    for (const tool of tools) {
      if (
        [
          'list_projects',
          'list_episodes',
          'get_screenplay',
          'get_shots',
          'get_dialogue',
          'list_assets',
        ].includes(tool.name)
      ) {
        expect(tool.description).toMatch(/cursor/);
        expect(tool.description).toMatch(/50/);
      }
    }

    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain('workflow_guide');

    const prompt = await client.getPrompt({ name: 'workflow_guide' });
    const guide = await call('get_workflow_guide');
    const promptText = (prompt.messages[0]?.content as { text: string }).text;

    expect(promptText).toBe(guide.content?.[0]?.text);
    expect(promptText).toContain('submit_generation');
  });

  it('list_projects returns only the bound team’s projects', async () => {
    const result = await call('list_projects', {});
    const projects = result.structuredContent?.projects as Array<{
      id: string;
      settings: Record<string, unknown>;
    }>;

    expect(result.isError).toBeFalsy();
    expect(projects.map((p) => p.id)).toEqual([teamA.projectId]);
    expect(projects[0]?.settings).toMatchObject({
      genre: 'drama',
      contentStyle: 'balanced',
    });

    const other = await call('get_project', { projectId: teamB.projectId });
    expect(other.isError).toBe(true);
    expect(other.structuredContent?.code).toBe('NOT_FOUND');
  });

  it('a second team’s episode and a deleted episode are NOT_FOUND, not FORBIDDEN', async () => {
    const foreign = await call('get_episode', { episodeId: teamB.episodeId });
    expect(foreign.isError).toBe(true);
    expect(foreign.structuredContent?.code).toBe('NOT_FOUND');

    const deleted = await call('get_episode', { episodeId: deletedEpisodeId });
    expect(deleted.isError).toBe(true);
    expect(deleted.structuredContent?.code).toBe('NOT_FOUND');

    const listed = await call('list_episodes', { projectId: teamA.projectId });
    const ids = (
      listed.structuredContent?.episodes as Array<{ id: string }>
    ).map((e) => e.id);
    expect(ids).toContain(teamA.episodeId);
    expect(ids).not.toContain(deletedEpisodeId);

    for (const name of ['get_screenplay', 'get_shots', 'get_dialogue']) {
      const result = await call(name, { episodeId: deletedEpisodeId });
      expect(result.isError).toBe(true);
      expect(result.structuredContent?.code).toBe('NOT_FOUND');
    }
  });

  it('get_episode derives the stages and get_screenplay pages by scene', async () => {
    const result = await call('get_episode', { episodeId: teamA.episodeId });
    expect(result.isError).toBeFalsy();

    const content = result.structuredContent as {
      episode: { status: string; version: number };
      stages: Array<{ key: string; state: string; origin: unknown }>;
      counts: Record<string, number>;
      screenplaySummary: { scenes: number };
      origin: { available: boolean };
    };

    expect(content.episode.status).toBe('story');
    expect(content.counts).toMatchObject({
      scenes: 3,
      shots: 0,
      dialogueLines: 0,
    });
    expect(content.screenplaySummary.scenes).toBe(3);
    expect(content.stages.map((s) => `${s.key}:${s.state}`)).toEqual([
      'ideation:available',
      'story:done',
      'screenplay:done',
      'shots:available',
      'audio:locked',
      'publish:locked',
    ]);
    // FILM-1903 adds episodes.generation_origin on a parallel branch.
    expect(content.origin.available).toBe(false);
    expect(content.stages.every((s) => s.origin === null)).toBe(true);

    const page1 = await call('get_screenplay', {
      episodeId: teamA.episodeId,
      limit: 2,
    });
    const scenes1 = page1.structuredContent?.scenes as Array<{
      number: number;
    }>;
    expect(scenes1.map((s) => s.number)).toEqual([1, 2]);
    expect(page1.structuredContent?.nextCursor).toBeTypeOf('string');

    const page2 = await call('get_screenplay', {
      episodeId: teamA.episodeId,
      limit: 2,
      cursor: page1.structuredContent?.nextCursor,
    });
    expect(
      (page2.structuredContent?.scenes as Array<{ number: number }>).map(
        (s) => s.number,
      ),
    ).toEqual([3]);
    expect(page2.structuredContent?.nextCursor).toBeNull();

    // The SDK validates inputSchema before the handler runs and answers a
    // JSON-RPC -32602, which the client throws; handler refusals come back as
    // isError results with VALIDATION_FAILED instead.
    await expect(
      call('get_shots', { episodeId: teamA.episodeId, limit: 51 }),
    ).rejects.toThrow(/less than or equal to 50/);
  });

  it('authors a project, an episode and assets with the forms’ rules, and never writes generated content', async () => {
    const created = await call('create_project', {
      name: 'From MCP',
      slug: `from-mcp-${randomUUID().slice(0, 8)}`,
    });
    expect(created.isError).toBeFalsy();
    const projectId = (created.structuredContent?.project as { id: string }).id;

    await expect(
      call('create_project', { name: 'Bad', slug: 'Not A Slug' }),
    ).rejects.toThrow(/lowercase letters, numbers, and hyphens/);

    const slugTaken = await call('create_project', {
      name: 'Twice',
      slug: (created.structuredContent?.project as { slug: string }).slug,
    });
    expect(slugTaken.isError).toBe(true);
    expect(slugTaken.structuredContent?.code).toBe('VALIDATION_FAILED');
    expect(slugTaken.content?.[0]?.text).toMatch(/slug already exists/);

    const settings = await call('update_project', {
      projectId,
      genre: 'comedy',
      defaultEpisodeDuration: 240,
    });
    expect(settings.isError).toBeFalsy();
    expect(
      (
        settings.structuredContent?.project as {
          settings: Record<string, unknown>;
        }
      ).settings,
    ).toMatchObject({
      genre: 'comedy',
      defaultEpisodeDuration: 240,
    });

    const episode = await call('create_episode', {
      projectId,
      title: 'Written over MCP',
      description: 'A logline',
      targetDuration: 300,
      contentStyle: 'dialogue-heavy',
    });
    expect(episode.isError).toBeFalsy();
    const ep = episode.structuredContent?.episode as {
      id: string;
      number: number;
      version: number;
      targetDurationSeconds: number;
      contentStyle: string;
    };
    expect(ep.number).toBe(1);
    expect(ep.targetDurationSeconds).toBe(300);
    expect(ep.contentStyle).toBe('dialogue-heavy');

    await expect(
      call('create_episode', { projectId, title: 'x', targetDuration: 10 }),
    ).rejects.toThrow(/greater than or equal to 60/);

    // The same number and title again: the slug (episode-1-written-over-mcp)
    // is what the database keeps unique per project. A different title with
    // the same number is accepted today, by the web too (KB filed with this
    // PR: the code's "unique_episode_number_per_project" does not exist).
    const numberTaken = await call('create_episode', {
      projectId,
      title: 'Written over MCP',
      number: 1,
    });
    expect(numberTaken.isError).toBe(true);
    expect(numberTaken.structuredContent?.code).toBe('VALIDATION_FAILED');
    expect(numberTaken.content?.[0]?.text).toMatch(/Episode 1 already exists/);

    const stale = await call('update_episode', {
      episodeId: ep.id,
      version: 99,
      title: 'Nope',
    });
    expect(stale.isError).toBe(true);
    expect(stale.structuredContent?.code).toBe('TARGET_CHANGED');

    const renamed = await call('update_episode', {
      episodeId: ep.id,
      version: ep.version,
      title: 'Renamed over MCP',
    });
    expect(renamed.isError).toBeFalsy();
    expect(
      (renamed.structuredContent?.episode as { title: string }).title,
    ).toBe('Renamed over MCP');

    const [row] = await rest(
      `/rest/v1/episodes?id=eq.${ep.id}&select=title,story_data,screenplay_data,shot_list,target_duration_seconds,metadata`,
      { method: 'GET', token: SERVICE_ROLE_KEY },
    );
    expect(row).toMatchObject({
      title: 'Renamed over MCP',
      story_data: null,
      screenplay_data: null,
      shot_list: null,
      target_duration_seconds: 300,
      metadata: { content_style: 'dialogue-heavy', target_duration: 300 },
    });

    const character = await call('upsert_asset', {
      projectId,
      type: 'character',
      name: 'Ada',
      description: 'The lead',
      character: {
        physicalAttributes: { age: 34, build: 'slim' },
        personality: 'Dry wit',
      },
    });
    expect(character.isError).toBeFalsy();
    expect(character.structuredContent?.action).toBe('created');

    const again = await call('upsert_asset', {
      projectId,
      type: 'character',
      name: 'Ada',
      character: { backstory: 'Grew up by the sea.' },
    });
    expect(again.structuredContent?.action).toBe('updated');
    expect((again.structuredContent?.asset as { id: string }).id).toBe(
      (character.structuredContent?.asset as { id: string }).id,
    );

    const location = await call('upsert_asset', {
      projectId,
      type: 'location',
      name: 'Pier',
      location: { setting: 'coastal', timeOfDay: 'dusk' },
    });
    expect(location.isError).toBeFalsy();

    const listed = await call('list_assets', { projectId });
    const assets = listed.structuredContent?.assets as Array<{
      type: string;
      name: string;
      personality?: string;
      backstory?: string;
      metadata?: Record<string, unknown>;
    }>;
    expect(assets.map((a) => `${a.type}:${a.name}`).sort()).toEqual([
      'character:Ada',
      'location:Pier',
    ]);
    expect(assets.find((a) => a.type === 'character')).toMatchObject({
      personality: 'Dry wit',
      backstory: 'Grew up by the sea.',
    });
    expect(assets.find((a) => a.type === 'location')?.metadata).toMatchObject({
      setting: 'coastal',
      timeOfDay: 'dusk',
    });

    await expect(
      call('upsert_asset', { projectId, type: 'prop', name: 'Box' }),
    ).rejects.toThrow(/Invalid enum value/);
  });

  it('records every call in mcp_tool_calls without the arguments', async () => {
    const rows = await rest(
      `/rest/v1/mcp_tool_calls?account_id=eq.${teamA.accountId}&select=*&order=created_at.asc`,
      { method: 'GET', token: SERVICE_ROLE_KEY },
    );
    const tools = new Set((rows as Array<{ tool: string }>).map((r) => r.tool));

    for (const name of [
      'list_projects',
      'get_episode',
      'create_project',
      'create_episode',
      'update_episode',
      'upsert_asset',
    ]) {
      expect(tools).toContain(name);
    }

    expect(
      (
        rows as Array<{
          tool: string;
          status: string;
          error_code: string | null;
        }>
      ).some(
        (r) =>
          r.tool === 'update_episode' &&
          r.status === 'error' &&
          r.error_code === 'TARGET_CHANGED',
      ),
    ).toBe(true);
    const columns = Object.keys(rows[0] as object);
    expect(columns).toEqual(
      expect.arrayContaining(['tool', 'status', 'error_code', 'duration_ms']),
    );
    for (const column of columns) {
      expect(column).not.toMatch(/argument|payload|input|result/);
    }
    expect(JSON.stringify(rows)).not.toContain('Renamed over MCP');
  });

  it('a read-only token is FORBIDDEN on an author tool and fine on a read tool', async () => {
    const readOnly = await connectWith(await mintPat(teamA, ['studio:read']));

    const read = (await readOnly.callTool({
      name: 'list_projects',
      arguments: {},
    })) as CallResult;
    expect(read.isError).toBeFalsy();

    const write = (await readOnly.callTool({
      name: 'create_project',
      arguments: { name: 'Nope' },
    })) as CallResult;
    expect(write.isError).toBe(true);
    expect(write.structuredContent?.code).toBe('FORBIDDEN');

    await readOnly.close();
  });
});
