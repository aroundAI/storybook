import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { analyticsTools } from '../src/server/tools/analytics';
import {
  ANON_KEY,
  JWT_SECRET,
  SERVICE_ROLE_KEY,
  SUPABASE_URL,
  type SeededTeam,
  mintPat,
  rest,
  seedDeletedEpisode,
  seedTeam,
} from './helpers/mcp-seed';

/**
 * The contract test (FILM-1904, extended by FILM-1905): the SDK's own
 * client, over Streamable HTTP, against StoryBook's MCP endpoint. Lists the
 * tools and calls whoami; checks the 401 shape without a token; then drives
 * every read and author tool.
 *
 * Two ways to run it:
 *
 *   # a running StoryBook and a token you made in Settings → Connected apps
 *   MCP_CONTRACT_URL=http://localhost:3201/api/mcp \
 *   MCP_CONTRACT_TOKEN=sbk_pat_… pnpm --filter @kit/studio-mcp test contract
 *
 *   # seed two teams and a token against a local Supabase (lane env); with
 *   # MCP_CONTRACT_URL the calls go to that server, without it the route
 *   # handlers run in-process behind the client's fetch, so no server is needed
 *   MCP_CONTRACT_SEED=1 E2E_SUPABASE_URL=http://127.0.0.1:55321 \
 *     pnpm --filter @kit/studio-mcp test contract
 *
 * Skipped without either, so the unit run needs no server and no database.
 * The checks that need a second team, a deleted episode, an admin read of
 * mcp_tool_calls or a read-only token run only when seeding.
 */
const URL_ = process.env.MCP_CONTRACT_URL;
const TOKEN_ENV = process.env.MCP_CONTRACT_TOKEN;
const SEED = process.env.MCP_CONTRACT_SEED === '1';

type CallResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type: string; text?: string }>;
};

describe.skipIf(!(URL_ && TOKEN_ENV) && !SEED)(
  'the MCP endpoint, through the SDK client',
  () => {
    const url = new URL(URL_ ?? 'http://localhost:3212/api/mcp');
    let TOKEN = TOKEN_ENV ?? '';
    let http: typeof fetch = fetch;
    let teamA: SeededTeam | undefined;
    let teamB: SeededTeam | undefined;
    let deletedEpisodeId: string | undefined;
    let client: Client;

    beforeAll(async () => {
      if (!URL_) {
        process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
        process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_ROLE_KEY;
        process.env.SUPABASE_JWT_SECRET = JWT_SECRET;
        process.env.CACHE_PROVIDER = 'memory';
        process.env.NEXT_PUBLIC_SITE_URL = url.origin;

        const { createMcpRouteHandlers } = await import(
          '../src/server/route-handler'
        );
        const handlers = createMcpRouteHandlers();

        http = (async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init);

          if (request.method === 'POST') return handlers.POST(request);
          if (request.method === 'DELETE') return handlers.DELETE(request);

          return handlers.GET(request);
        }) as typeof fetch;
      }

      if (SEED) {
        [teamA, teamB] = await Promise.all([seedTeam('a'), seedTeam('b')]);
        deletedEpisodeId = await seedDeletedEpisode(teamA);
        TOKEN = await mintPat(teamA, ['studio:read', 'studio:write']);
      }

      client = await connect();
    }, 60_000);

    afterAll(async () => {
      await client?.close();
    });

    async function connect(token = TOKEN) {
      const transport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
        ...(URL_ ? {} : { fetch: http }),
      });
      const c = new Client({ name: 'contract-test', version: '0' });
      await c.connect(transport);

      return c;
    }

    const call = (name: string, args: Record<string, unknown> = {}) =>
      client.callTool({ name, arguments: args }) as Promise<CallResult>;

    it('initializes, lists tools with annotations, and whoami answers', async () => {
      const { tools } = await client.listTools();
      const whoami = tools.find((tool) => tool.name === 'whoami');

      expect(whoami).toBeDefined();
      expect(whoami?.annotations).toMatchObject({
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
      });

      const result = await call('whoami');

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        user: { id: expect.any(String) },
        team: { id: expect.any(String), slug: expect.any(String) },
        connection: { scopes: expect.any(Array) },
        mode: { generation: 'external' },
      });
    });

    it('a wrong team slug is FORBIDDEN in the error contract', async () => {
      const result = await call('whoami', { account: 'not-this-team' });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        code: 'FORBIDDEN',
        retryable: false,
      });
    });

    it('no token: 401 with WWW-Authenticate naming the protected-resource metadata', async () => {
      const response = await http(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });

      expect(response.status).toBe(401);
      expect(response.headers.get('www-authenticate')).toMatch(
        /^Bearer resource_metadata=".+\/\.well-known\/oauth-protected-resource"$/,
      );
      expect(await response.json()).toMatchObject({
        error: { code: 'UNAUTHORIZED' },
      });
    });

    it('GET and DELETE are 405', async () => {
      for (const method of ['GET', 'DELETE']) {
        const response = await http(url, {
          method,
          headers: { Authorization: `Bearer ${TOKEN}` },
        });

        expect(response.status).toBe(405);
        expect(response.headers.get('allow')).toContain('POST');
      }
    });

    describe('the read and author tools (FILM-1905)', () => {
      const PAGED = [
        'list_projects',
        'list_episodes',
        'get_screenplay',
        'get_shots',
        'get_dialogue',
        'list_assets',
      ];

      it('lists every tool (orientation, read, author, analytics, generation) and offers the workflow guide as a prompt too', async () => {
        const { tools } = await client.listTools();
        const names = tools.map((tool) => tool.name);

        expect(names.sort()).toEqual(
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
            'link_assets_to_episode',
            // FILM-1906's list, pinned by name in analytics-catalogue.test.ts
            ...analyticsTools.map((tool) => tool.name),
            'start_generation',
            'get_brief',
            'submit_generation',
            'finalize_generation',
            'get_run',
            'cancel_generation',
            'get_generation_history',
          ].sort(),
        );

        for (const tool of tools.filter((t) => PAGED.includes(t.name))) {
          expect(tool.description).toMatch(/cursor/);
          expect(tool.description).toMatch(/50/);
        }

        const { prompts } = await client.listPrompts();
        expect(prompts.map((p) => p.name)).toContain('workflow_guide');

        const prompt = await client.getPrompt({ name: 'workflow_guide' });
        const guide = await call('get_workflow_guide');
        const promptText = (prompt.messages[0]?.content as { text: string })
          .text;

        expect(promptText).toBe(guide.content?.[0]?.text);
        expect(promptText).toContain('submit_generation');
      });

      it('authors a project, an episode and assets with the forms’ rules, and never writes generated content', async () => {
        const created = await call('create_project', {
          name: 'From MCP',
          slug: `from-mcp-${randomUUID().slice(0, 8)}`,
        });
        expect(created.isError).toBeFalsy();
        const project = created.structuredContent?.project as {
          id: string;
          slug: string;
        };

        // The SDK validates inputSchema before the handler runs and answers
        // a JSON-RPC -32602, which the client throws; a refusal the handler
        // or the database makes is an isError result with the contract's code.
        await expect(
          call('create_project', { name: 'Bad', slug: 'Not A Slug' }),
        ).rejects.toThrow(/lowercase letters, numbers, and hyphens/);

        const slugTaken = await call('create_project', {
          name: 'Twice',
          slug: project.slug,
        });
        expect(slugTaken.isError).toBe(true);
        expect(slugTaken.structuredContent?.code).toBe('VALIDATION_FAILED');
        expect(slugTaken.content?.[0]?.text).toMatch(/slug already exists/);

        const settings = await call('update_project', {
          projectId: project.id,
          genre: 'comedy',
          defaultEpisodeDuration: 240,
        });
        expect(settings.isError).toBeFalsy();
        expect(
          (settings.structuredContent?.project as { settings: unknown })
            .settings,
        ).toMatchObject({ genre: 'comedy', defaultEpisodeDuration: 240 });

        // FILM-2004: brand and edit policy, partial in, defaults out
        const branded = await call('update_project', {
          projectId: project.id,
          brand: { colors: { captionText: '#FF0000' } },
          editPolicy: { maxShotLength: 4 },
        });
        expect(branded.isError).toBeFalsy();
        const read = await call('get_project', { projectId: project.id });
        expect(read.structuredContent).toMatchObject({
          brand: {
            colors: { captionText: '#FF0000', primary: '#2563EB' },
            transitionStyle: 'cut',
          },
          editPolicy: { minShotLength: 1.2, maxShotLength: 4 },
        });
        const crossed = await call('update_project', {
          projectId: project.id,
          editPolicy: { minShotLength: 5 },
        });
        expect(crossed.isError).toBe(true);
        expect(crossed.structuredContent?.code).toBe('VALIDATION_FAILED');

        const listed = await call('list_projects');
        expect(
          (listed.structuredContent?.projects as Array<{ id: string }>).map(
            (p) => p.id,
          ),
        ).toContain(project.id);

        const episode = await call('create_episode', {
          projectId: project.id,
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
          call('create_episode', {
            projectId: project.id,
            title: 'x',
            targetDuration: 10,
          }),
        ).rejects.toThrow(/greater than or equal to 60/);

        // The number is what the database keeps unique per project (KB-175),
        // whatever the title.
        const numberTaken = await call('create_episode', {
          projectId: project.id,
          title: 'A different title',
          number: 1,
        });
        expect(numberTaken.isError).toBe(true);
        expect(numberTaken.structuredContent?.code).toBe('VALIDATION_FAILED');
        expect(numberTaken.content?.[0]?.text).toMatch(
          /Episode 1 already exists/,
        );

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

        // A fresh episode: draft, no stage content, every generated field
        // untouched by the author tools.
        const fresh = await call('get_episode', { episodeId: ep.id });
        const content = fresh.structuredContent as {
          episode: { status: string; title: string };
          story: unknown;
          screenplaySummary: unknown;
          counts: Record<string, number>;
          stages: Array<{ key: string; state: string }>;
        };
        expect(content.episode).toMatchObject({
          status: 'draft',
          title: 'Renamed over MCP',
        });
        expect(content.story).toBeNull();
        expect(content.screenplaySummary).toBeNull();
        expect(content.counts).toMatchObject({
          scenes: 0,
          shots: 0,
          dialogueLines: 0,
        });
        expect(content.stages.map((s) => `${s.key}:${s.state}`)).toEqual([
          'ideation:available',
          'story:available',
          'screenplay:locked',
          'shots:locked',
          'audio:locked',
          'publish:locked',
        ]);

        const screenplay = await call('get_screenplay', { episodeId: ep.id });
        expect(screenplay.structuredContent?.scenes).toEqual([]);
        expect(screenplay.structuredContent?.note).toMatch(/no screenplay/i);

        const character = await call('upsert_asset', {
          projectId: project.id,
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
          projectId: project.id,
          type: 'character',
          name: 'Ada',
          character: { backstory: 'Grew up by the sea.' },
        });
        expect(again.structuredContent?.action).toBe('updated');
        expect((again.structuredContent?.asset as { id: string }).id).toBe(
          (character.structuredContent?.asset as { id: string }).id,
        );

        const location = await call('upsert_asset', {
          projectId: project.id,
          type: 'location',
          name: 'Pier',
          location: { setting: 'coastal', timeOfDay: 'dusk' },
        });
        expect(location.isError).toBeFalsy();

        const assets = (await call('list_assets', { projectId: project.id }))
          .structuredContent?.assets as Array<{
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
        expect(
          assets.find((a) => a.type === 'location')?.metadata,
        ).toMatchObject({ setting: 'coastal', timeOfDay: 'dusk' });

        await expect(
          call('upsert_asset', {
            projectId: project.id,
            type: 'prop',
            name: 'Box',
          }),
        ).rejects.toThrow(/Invalid enum value/);

        await expect(
          call('get_shots', { episodeId: ep.id, limit: 51 }),
        ).rejects.toThrow(/less than or equal to 50/);
      });

      describe.skipIf(!SEED)(
        'with a second team and a deleted episode seeded',
        () => {
          it('list_projects returns only the bound team’s projects, with their settings', async () => {
            const result = await call('list_projects');
            const projects = result.structuredContent?.projects as Array<{
              id: string;
              settings: Record<string, unknown>;
            }>;

            expect(projects.map((p) => p.id)).toContain(teamA!.projectId);
            expect(projects.map((p) => p.id)).not.toContain(teamB!.projectId);
            expect(
              projects.find((p) => p.id === teamA!.projectId)?.settings,
            ).toMatchObject({ genre: 'drama', contentStyle: 'balanced' });

            const other = await call('get_project', {
              projectId: teamB!.projectId,
            });
            expect(other.isError).toBe(true);
            expect(other.structuredContent?.code).toBe('NOT_FOUND');
          });

          it('a second team’s episode and a deleted episode are NOT_FOUND, not FORBIDDEN', async () => {
            for (const episodeId of [teamB!.episodeId, deletedEpisodeId!]) {
              for (const name of [
                'get_episode',
                'get_screenplay',
                'get_shots',
                'get_dialogue',
              ]) {
                const result = await call(name, { episodeId });
                expect(result.isError).toBe(true);
                expect(result.structuredContent?.code).toBe('NOT_FOUND');
              }
            }

            const listed = await call('list_episodes', {
              projectId: teamA!.projectId,
            });
            const ids = (
              listed.structuredContent?.episodes as Array<{ id: string }>
            ).map((e) => e.id);
            expect(ids).toContain(teamA!.episodeId);
            expect(ids).not.toContain(deletedEpisodeId);
          });

          it('get_episode derives the stages of a story-stage episode and get_screenplay pages by scene', async () => {
            const result = await call('get_episode', {
              episodeId: teamA!.episodeId,
            });
            const content = result.structuredContent as {
              episode: { status: string };
              stages: Array<{ key: string; state: string; origin: unknown }>;
              counts: Record<string, number>;
              screenplaySummary: { scenes: number };
              origin: { perStage: Record<string, unknown> };
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
            // The origin comes from episodes.generation_origin (FILM-1903),
            // keyed by stage: the seeded story was stamped external, the
            // screenplay carries no key, so it reads as written by hand.
            expect(
              content.stages.find((s) => s.key === 'story')?.origin,
            ).toEqual({
              kind: 'external',
              clientName: 'contract test',
              model: 'self',
            });
            expect(
              content.stages.find((s) => s.key === 'screenplay')?.origin,
            ).toBeNull();
            expect(content.origin.perStage).toEqual({
              story: {
                kind: 'external',
                clientName: 'contract test',
                model: 'self',
              },
            });

            const page1 = await call('get_screenplay', {
              episodeId: teamA!.episodeId,
              limit: 2,
            });
            expect(
              (
                page1.structuredContent?.scenes as Array<{ number: number }>
              ).map((s) => s.number),
            ).toEqual([1, 2]);
            expect(page1.structuredContent?.nextCursor).toBeTypeOf('string');

            const page2 = await call('get_screenplay', {
              episodeId: teamA!.episodeId,
              limit: 2,
              cursor: page1.structuredContent?.nextCursor,
            });
            expect(
              (
                page2.structuredContent?.scenes as Array<{ number: number }>
              ).map((s) => s.number),
            ).toEqual([3]);
            expect(page2.structuredContent?.nextCursor).toBeNull();
          });

          it('the authored episode’s row holds no story, screenplay or shot list', async () => {
            const [row] = await rest(
              `/rest/v1/episodes?title=eq.Renamed%20over%20MCP&select=story_data,screenplay_data,shot_list,target_duration_seconds,metadata&order=created_at.desc&limit=1`,
              { method: 'GET', token: SERVICE_ROLE_KEY },
            );

            expect(row).toMatchObject({
              story_data: null,
              screenplay_data: null,
              shot_list: null,
              target_duration_seconds: 300,
              metadata: {
                content_style: 'dialogue-heavy',
                target_duration: 300,
              },
            });
          });

          it('records every call in mcp_tool_calls without the arguments', async () => {
            const rows = (await rest(
              `/rest/v1/mcp_tool_calls?account_id=eq.${teamA!.accountId}&select=*&order=created_at.asc`,
              { method: 'GET', token: SERVICE_ROLE_KEY },
            )) as Array<Record<string, unknown>>;
            const tools = new Set(rows.map((r) => r.tool));

            for (const name of [
              'whoami',
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
              rows.some(
                (r) =>
                  r.tool === 'update_episode' &&
                  r.status === 'error' &&
                  r.error_code === 'TARGET_CHANGED',
              ),
            ).toBe(true);

            const columns = Object.keys(rows[0]!);
            expect(columns).toEqual(
              expect.arrayContaining([
                'tool',
                'status',
                'error_code',
                'duration_ms',
              ]),
            );
            for (const column of columns) {
              expect(column).not.toMatch(/argument|payload|input|result/);
            }
            expect(JSON.stringify(rows)).not.toContain('Renamed over MCP');
          });

          it('a read-only token is FORBIDDEN on an author tool and fine on a read tool', async () => {
            const readOnly = await connect(
              await mintPat(teamA!, ['studio:read']),
            );

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
        },
      );
    });
  },
);
