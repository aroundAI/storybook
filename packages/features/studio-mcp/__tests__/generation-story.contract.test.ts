import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  SERVICE_ROLE_KEY,
  type SeededTeam,
  mintPat,
  rest,
  seedTeam,
} from './helpers/mcp-seed';

/**
 * FILM-1908, the story stage end to end: the SDK's own client, with a
 * personal access token, against a running StoryBook (the generation tools
 * need the app's episode context loader, so there is no in-process mode).
 * It creates an episode, starts the story stage, has one submission refused
 * and the next accepted, and then reads what the commit wrote and compares
 * it with what server mode wrote for the same model output: the story
 * parity fixture of FILM-1901.
 *
 *   MCP_CONTRACT_SEED=1 MCP_CONTRACT_URL=http://localhost:3216/api/mcp \
 *     E2E_SUPABASE_URL=http://127.0.0.1:55321 \
 *     pnpm --filter @kit/studio-mcp test generation-story
 */
const URL_ = process.env.MCP_CONTRACT_URL;
const SEED = process.env.MCP_CONTRACT_SEED === '1';

const repo = path.resolve(__dirname, '../../../..');
const SUBMISSION = JSON.parse(
  readFileSync(path.join(__dirname, 'fixtures/story-submission.json'), 'utf8'),
).output;
const PARITY = JSON.parse(
  readFileSync(
    path.join(
      repo,
      'apps/web/lambda/llm-worker/__tests__/fixtures/story-parity.json',
    ),
    'utf8',
  ),
) as {
  writes: Array<{ table: string; op: string; payload: unknown }>;
};

function serverWrite<T = Record<string, unknown>>(table: string, op: string) {
  const write = PARITY.writes.find(
    (w) => w.table === table && w.op === op && w.payload,
  );

  if (!write) throw new Error(`No ${table} ${op} in the parity fixture`);

  return write.payload as T;
}

type CallResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

const admin = (pathAndQuery: string) =>
  rest(pathAndQuery, { method: 'GET', token: SERVICE_ROLE_KEY });

describe.skipIf(!(SEED && URL_))(
  'the story stage over MCP, end to end (FILM-1908)',
  () => {
    let team: SeededTeam;
    let client: Client;
    let episodeId: string;
    let runId: string;
    let startedAt: string;

    const call = (name: string, args: Record<string, unknown> = {}) =>
      client.callTool({ name, arguments: args }) as Promise<CallResult>;

    beforeAll(async () => {
      team = await seedTeam('gen1908');
      startedAt = new Date().toISOString();

      // What the parity fixture's episode context held: the project's
      // settings, two characters, a location and an open thread
      await rest(`/rest/v1/projects?id=eq.${team.projectId}`, {
        method: 'PATCH',
        token: team.token,
        body: {
          metadata: {
            genre: 'sci-fi',
            targetAudience: 'adults',
            videoStyle: 'cinematic',
          },
        },
      });

      await rest('/rest/v1/assets', {
        token: team.token,
        body: [
          {
            project_id: team.projectId,
            type: 'character',
            name: 'Maya Chen',
            description: 'Commander of the relay mission.',
          },
          {
            project_id: team.projectId,
            type: 'character',
            name: 'Director Williams',
            description: 'Mission director back on Earth.',
          },
          {
            project_id: team.projectId,
            type: 'location',
            name: 'Observation Deck',
            description: 'A glass-walled deck facing Earth.',
          },
        ],
      });

      // threads are written by the canon tools, not directly by a member
      await rest('/rest/v1/narrative_threads', {
        token: SERVICE_ROLE_KEY,
        body: {
          project_id: team.projectId,
          thread_name: 'The missing memo',
          thread_type: 'mystery',
          description: 'A memo nobody admits to.',
          status: 'open',
          // opened in the seeded pilot, as the fixture's episode 1
          opened_at: team.episodeId,
          episodes_touched: [team.episodeId],
        },
      });

      const token = await mintPat(team, ['studio:read', 'studio:write']);
      const transport = new StreamableHTTPClientTransport(new URL(URL_!), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      });
      client = new Client({ name: 'Claude', version: '0' });
      await client.connect(transport);
    }, 60_000);

    afterAll(async () => {
      await client?.close();
    });

    it('creates the episode and starts the story stage: an external run and its brief', async () => {
      const created = await call('create_episode', {
        projectId: team.projectId,
        title: 'The Last Signal',
        description:
          'A lonely astronaut hears a signal that carries her own voice.',
        number: 2,
        targetDuration: 300,
        contentStyle: 'dialogue-heavy',
      });
      expect(created.isError).toBeFalsy();
      episodeId = (created.structuredContent!.episode as { id: string }).id;

      const started = await call('start_generation', {
        stage: 'story',
        episodeId,
      });
      expect(started.isError).toBeFalsy();

      const { run, brief } = started.structuredContent as {
        run: { runId: string; mode: string; status: string };
        brief: {
          part: { key: string };
          bytes: number;
          outputSchema: object;
          qualityRubric?: string;
          instructions: string;
        };
      };
      runId = run.runId;

      expect(run).toMatchObject({ mode: 'external', status: 'briefed' });
      expect(brief.part.key).toBe('story');
      expect(brief.bytes).toBeLessThan(60 * 1024);
      expect(brief.instructions).toContain('The Last Signal');
      expect(brief.qualityRubric).toBeTruthy();

      const [row] = await admin(
        `/rest/v1/generation_runs?id=eq.${runId}&select=mode,status,connection_id,origin`,
      );
      expect(row).toMatchObject({ mode: 'external', status: 'briefed' });
      expect(row.connection_id).toEqual(expect.any(String));
    });

    it('a second start on the same episode and stage is RUN_IN_PROGRESS naming the holder', async () => {
      const second = await call('start_generation', {
        stage: 'story',
        episodeId,
      });

      expect(second.isError).toBe(true);
      expect(second.structuredContent).toMatchObject({
        code: 'RUN_IN_PROGRESS',
        details: {
          holder: { runId, mode: 'external', userId: team.userId },
        },
      });
    });

    it('a submission missing a field is refused with its path; the fixed one is accepted and committed', async () => {
      const { fullText: _missing, ...story } = SUBMISSION.story;

      const refused = await call('submit_generation', {
        runId,
        partKey: 'story',
        output: { ...SUBMISSION, story },
      });
      expect(refused.isError).toBeFalsy();
      expect(refused.structuredContent).toMatchObject({
        status: 'rejected',
        partKey: 'story',
        errors: [expect.objectContaining({ path: 'story.fullText' })],
      });

      const [stillDraft] = await admin(
        `/rest/v1/episodes?id=eq.${episodeId}&select=status,story_data`,
      );
      expect(stillDraft).toEqual({ status: 'draft', story_data: null });

      const accepted = await call('submit_generation', {
        runId,
        partKey: 'story',
        output: SUBMISSION,
        model: 'claude-contract-test',
      });
      expect(accepted.isError).toBeFalsy();
      expect(accepted.structuredContent).toMatchObject({
        status: 'accepted',
        next: null,
        remaining: 0,
        finalized: {
          status: 'committed',
          origin: {
            kind: 'external',
            clientName: 'contract test',
            model: 'claude-contract-test',
            modelSelfReported: true,
          },
        },
      });

      const retried = await call('submit_generation', {
        runId,
        partKey: 'story',
        output: SUBMISSION,
        model: 'claude-contract-test',
      });
      expect(retried.structuredContent).toMatchObject({
        status: 'accepted',
        replayed: true,
      });
    });

    it('the story row matches what server mode wrote for the same output, stamped with the external origin', async () => {
      const [episode] = await admin(
        `/rest/v1/episodes?id=eq.${episodeId}&select=status,target_duration_seconds,story_data,generation_origin`,
      );
      const server = serverWrite<{
        status: string;
        target_duration_seconds: number;
        story_data: Record<string, unknown>;
      }>('episodes', 'update');

      expect(episode.status).toBe(server.status);
      expect(episode.target_duration_seconds).toBe(
        server.target_duration_seconds,
      );

      // Mode-specific: when it was written, by which mode, and the server's
      // own evaluation (an external run makes no evaluator call)
      const comparable = (data: Record<string, unknown>) => {
        const {
          generatedAt: _at,
          generatedBy: _by,
          viralQuality: _vq,
          ...rest
        } = data;
        return JSON.parse(JSON.stringify(rest));
      };

      expect(comparable(episode.story_data)).toEqual(
        comparable(server.story_data),
      );
      expect(episode.story_data.generatedBy).toMatchObject({
        mode: 'external',
      });
      expect(episode.generation_origin.story).toMatchObject({
        kind: 'external',
        runId,
        clientName: 'contract test',
        model: 'claude-contract-test',
        promptSlug: 'story-generation',
      });

      const [run] = await admin(
        `/rest/v1/generation_runs?id=eq.${runId}&select=status,finalized_at`,
      );
      expect(run.status).toBe('committed');

      const revisions = await admin(
        `/rest/v1/content_revisions?run_id=eq.${runId}&select=target_id,stage,snapshot`,
      );
      expect(revisions).toEqual([
        expect.objectContaining({ target_id: episodeId, stage: 'story' }),
      ]);
    });

    it('the canon tables and auto-created assets match the server-mode writes', async () => {
      const [events, states, threads, summary, world, assets, characters] =
        await Promise.all([
          admin(
            `/rest/v1/immutable_events?established_in=eq.${episodeId}&select=event_type,event_key,season,episode_number,description,metadata&order=event_key`,
          ),
          admin(
            `/rest/v1/character_states?episode_id=eq.${episodeId}&select=character_id,state_type,state_value,trigger_event`,
          ),
          admin(
            `/rest/v1/narrative_threads?project_id=eq.${team.projectId}&select=thread_name,thread_type,description,promises,status,auto_generated&order=thread_name`,
          ),
          admin(
            `/rest/v1/episode_summaries?episode_id=eq.${episodeId}&select=plot_summary,key_events,character_changes,sentiment_score`,
          ),
          admin(
            `/rest/v1/world_states?episode_id=eq.${episodeId}&select=location,time_period,atmosphere,active_conflicts`,
          ),
          admin(
            `/rest/v1/assets?project_id=eq.${team.projectId}&metadata->>autoCreated=eq.true&select=type,name,description,metadata&order=name`,
          ),
          admin(
            `/rest/v1/assets?project_id=eq.${team.projectId}&type=eq.character&select=id,name`,
          ),
        ]);

      const strip = <T extends Record<string, unknown>>(
        rows: T[],
        keys: string[],
      ) =>
        rows.map((row) =>
          Object.fromEntries(
            Object.entries(row).filter(([key]) => !keys.includes(key)),
          ),
        );

      const serverEvents = serverWrite<Array<Record<string, unknown>>>(
        'immutable_events',
        'insert',
      );
      expect(events).toEqual(
        strip(serverEvents, ['project_id', 'established_in', 'created_by']),
      );

      const nameOf = new Map(
        (characters as Array<{ id: string; name: string }>).map((c) => [
          c.id,
          c.name,
        ]),
      );
      const serverStates = serverWrite<Array<Record<string, unknown>>>(
        'character_states',
        'insert',
      );
      const serverName: Record<string, string> = {
        c1: 'Maya Chen',
        c2: 'Director Williams',
      };
      expect(
        (states as Array<Record<string, unknown>>)
          .map(({ character_id, ...rest }) => ({
            character: nameOf.get(character_id as string),
            ...rest,
          }))
          .sort((a, b) =>
            String(a.character).localeCompare(String(b.character)),
          ),
      ).toEqual(
        serverStates
          .map(({ character_id, episode_id: _e, ...rest }) => ({
            character: serverName[character_id as string],
            ...rest,
          }))
          .sort((a, b) =>
            String(a.character).localeCompare(String(b.character)),
          ),
      );

      const opened = serverWrite('narrative_threads', 'insert');
      const progressed = serverWrite('narrative_threads', 'update');
      expect(threads).toEqual([
        {
          thread_name: 'The missing memo',
          thread_type: 'mystery',
          description: progressed.description,
          promises: [],
          status: progressed.status,
          auto_generated: false,
        },
        {
          thread_name: opened.thread_name,
          thread_type: opened.thread_type,
          description: opened.description,
          promises: opened.promises,
          status: opened.status,
          auto_generated: opened.auto_generated,
        },
      ]);

      const serverSummary = serverWrite('episode_summaries', 'upsert');
      expect(summary).toEqual([
        {
          plot_summary: serverSummary.plot_summary,
          key_events: serverSummary.key_events,
          character_changes: serverSummary.character_changes,
          sentiment_score: serverSummary.sentiment_score,
        },
      ]);

      const serverWorld = serverWrite('world_states', 'insert');
      expect(world).toEqual([
        {
          location: serverWorld.location,
          time_period: serverWorld.time_period,
          atmosphere: serverWorld.atmosphere,
          active_conflicts: serverWorld.active_conflicts,
        },
      ]);

      const serverAssets = PARITY.writes
        .filter((w) => w.table === 'assets' && w.op === 'upsert')
        .flatMap((w) => w.payload as Array<Record<string, unknown>>)
        .map(({ project_id: _p, ...rest }) => rest)
        .sort((a, b) => String(a.name).localeCompare(String(b.name)));
      expect(assets).toEqual(serverAssets);
    });

    it('StoryBook made no model call for the run: no usage row, no generation job', async () => {
      const usage = await admin(
        `/rest/v1/llm_usage_analytics?or=(run_id.eq.${runId},account_id.eq.${team.accountId})&created_at=gte.${startedAt}&select=id`,
      );
      expect(usage).toEqual([]);

      const jobs = await admin(
        `/rest/v1/generation_jobs?reference_id=eq.${episodeId}&select=id`,
      );
      expect(jobs).toEqual([]);
    });

    it('get_generation_history shows the run, its mode and origin, and the refused submission', async () => {
      const history = await call('get_generation_history', { episodeId });

      expect(history.isError).toBeFalsy();
      expect(history.structuredContent).toMatchObject({
        runs: [
          {
            runId,
            stage: 'story',
            mode: 'external',
            status: 'committed',
            origin: {
              kind: 'mcp',
              clientName: 'contract test',
              model: 'claude-contract-test',
            },
            parts: [
              {
                partKey: 'story',
                status: 'accepted',
                model: 'claude-contract-test',
                validationFailures: [
                  {
                    errors: [
                      expect.objectContaining({ path: 'story.fullText' }),
                    ],
                  },
                ],
              },
            ],
          },
        ],
      });
    });

    it('get_episode reads the story and its external origin', async () => {
      const episode = await call('get_episode', { episodeId });

      expect(episode.isError).toBeFalsy();
      expect(JSON.stringify(episode.structuredContent)).toContain(
        '"kind":"external"',
      );
    });
    it('regenerating the story over MCP replaces its generated canon instead of adding to it', async () => {
      const canonCounts = async () => {
        const [events, states, threads] = await Promise.all([
          admin(
            `/rest/v1/immutable_events?established_in=eq.${episodeId}&select=id`,
          ),
          admin(
            `/rest/v1/character_states?episode_id=eq.${episodeId}&select=id`,
          ),
          admin(
            `/rest/v1/narrative_threads?opened_at=eq.${episodeId}&auto_generated=eq.true&select=id`,
          ),
        ]);

        return {
          events: events.length,
          states: states.length,
          threads: threads.length,
        };
      };

      const before = await canonCounts();
      expect(before).toEqual({ events: 2, states: 2, threads: 1 });

      const started = await call('start_generation', {
        stage: 'story',
        episodeId,
      });
      expect(started.isError).toBeFalsy();
      const secondRun = (started.structuredContent!.run as { runId: string })
        .runId;

      const accepted = await call('submit_generation', {
        runId: secondRun,
        partKey: 'story',
        output: SUBMISSION,
      });
      expect(accepted.structuredContent).toMatchObject({
        finalized: { status: 'committed' },
      });

      // the last generation's canon is cleared in the same commit, under the
      // user's session, so nothing is doubled
      expect(await canonCounts()).toEqual(before);

      const revisions = await admin(
        `/rest/v1/content_revisions?run_id=eq.${secondRun}&select=snapshot`,
      );
      expect(revisions).toHaveLength(1);
      expect(JSON.stringify(revisions[0].snapshot)).toContain(
        'Commander Maya Chen',
      );
    });
  },
);
