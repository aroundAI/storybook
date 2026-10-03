import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ALL_STAGES } from '@kit/generation';

import {
  type Call,
  type StageRun,
  type ToolResult,
  WORLD,
  driveEpisode,
  driveRemainingStages,
  linkedCast,
  patient,
} from './helpers/all-stages-script';
import {
  ANON_KEY,
  JWT_SECRET,
  SERVICE_ROLE_KEY,
  SUPABASE_URL,
  type SeededTeam,
  mintPat,
  rest,
  seedTeam,
} from './helpers/mcp-seed';

/**
 * FILM-1909: every registered stage completes over MCP in external mode
 * against a seeded episode, driven by the scripted SDK client, and
 * StoryBook makes no model call: no llm_usage_analytics row for the team.
 * Then the three edit tools change a scene, a shot and a line through
 * apply_generation_commit. Against a local Supabase; the route handlers run
 * in process with the worker's episode context loader, as the MCP route
 * configures them, or against a server with MCP_CONTRACT_URL.
 *
 *   MCP_CONTRACT_SEED=1 E2E_SUPABASE_URL=http://127.0.0.1:55321 \
 *     pnpm --filter @kit/studio-mcp exec vitest run generation-all-stages
 */
const SEED = process.env.MCP_CONTRACT_SEED === '1';
const URL_ = process.env.MCP_CONTRACT_URL;

type Row = Record<string, unknown>;

const admin = (pathAndQuery: string) =>
  rest(pathAndQuery, { method: 'GET', token: SERVICE_ROLE_KEY }) as Promise<
    Row[]
  >;

describe.skipIf(!SEED)(
  'every stage over MCP in external mode, then the edits (FILM-1909)',
  () => {
    const url = new URL(URL_ ?? 'http://localhost:3220/api/mcp');
    let team: SeededTeam;
    let client: Client;
    let call: Call;
    let episodeId: string;
    let mayaId: string;
    let cast: Array<{ id: string; name: string; type: string }>;
    let startedAt: string;
    const runs: StageRun[] = [];
    let audioChild: { runId: string; mode: string };

    beforeAll(async () => {
      let http: typeof fetch = fetch;

      if (!URL_) {
        Object.assign(process.env, {
          NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
          SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
          SUPABASE_JWT_SECRET: JWT_SECRET,
          CACHE_PROVIDER: 'memory',
          NEXT_PUBLIC_SITE_URL: url.origin,
          // A whole episode is more writes than a minute's default allows;
          // the script also waits out RATE_LIMITED, as an agent would
          MCP_RATE_LIMIT_WRITES_PER_MIN: '600',
          MCP_RATE_LIMIT_CALLS_PER_MIN: '1200',
        });

        const server = await import('../src/server');
        const { episodeContextLoader } = await import(
          '../../../../apps/web/lambda/llm-worker/utils/episode-context-loader'
        );

        // What apps/web/app/api/mcp/route.ts configures
        server.configureGenerationTools({
          episodeContext: (c) => episodeContextLoader(c, { semantic: false }),
        });

        const handlers = server.createMcpRouteHandlers();
        http = (async (input: RequestInfo | URL, init?: RequestInit) => {
          const request = new Request(input, init);
          if (request.method === 'POST') return handlers.POST(request);
          if (request.method === 'DELETE') return handlers.DELETE(request);
          return handlers.GET(request);
        }) as typeof fetch;
      }

      team = await seedTeam('all1909');
      startedAt = new Date().toISOString();

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

      const assets = await rest('/rest/v1/assets', {
        token: team.token,
        prefer: 'return=representation',
        body: [
          ...WORLD.characters.map((name) => ({
            project_id: team.projectId,
            type: 'character',
            name,
            description: `${name}, of the relay crew.`,
          })),
          {
            project_id: team.projectId,
            type: 'location',
            name: WORLD.location,
            description: 'A glass-walled deck facing Earth.',
          },
        ],
      });
      cast = assets;
      mayaId = cast.find((a) => a.name === WORLD.characters[0])!.id;

      const token = await mintPat(team, ['studio:read', 'studio:write']);
      client = new Client({ name: 'Claude', version: '0' });
      await client.connect(
        new StreamableHTTPClientTransport(url, {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
          ...(URL_ ? {} : { fetch: http }),
        }),
      );
      call = patient(
        (name, args) =>
          client.callTool({ name, arguments: args }) as Promise<ToolResult>,
      );

      const created = await call('create_episode', {
        projectId: team.projectId,
        title: 'The Last Signal',
        description:
          'A lonely astronaut hears a signal that carries her own voice.',
        number: 2,
        targetDuration: 180,
        contentStyle: 'dialogue-heavy',
      });
      episodeId = (created.structuredContent!.episode as { id: string }).id;

      // The cast linked on the web, as the episode header's link action does
      const [row] = await admin(
        `/rest/v1/episodes?id=eq.${episodeId}&select=metadata`,
      );
      await rest(`/rest/v1/episodes?id=eq.${episodeId}`, {
        method: 'PATCH',
        token: team.token,
        body: { metadata: linkedCast(row!.metadata as Row, cast) },
      });
    }, 120_000);

    afterAll(async () => {
      await client?.close();
    });

    const ids = () => ({ projectId: team.projectId, episodeId });

    it(
      'ideation → story → screenplay → shots → audio cues, each committed in external mode',
      { timeout: 300_000 },
      async () => {
        const episode = await driveEpisode(call, ids());
        runs.push(...episode.runs);
        audioChild = episode.audioChild;

        expect(runs.map((run) => run.stage)).toEqual([
          'ideation',
          'story',
          'screenplay',
          'shots',
          'audio_cues',
        ]);

        const [row] = await admin(
          `/rest/v1/episodes?id=eq.${episodeId}&select=status,metadata,story_data,screenplay_data,shot_list,generation_origin`,
        );
        const metadata = row!.metadata as { ideas?: unknown[] };
        const screenplay = row!.screenplay_data as { scenes: unknown[] };
        const origin = row!.generation_origin as Record<string, Row>;

        expect(metadata.ideas).toHaveLength(2);
        expect((row!.story_data as Row).fullStory).toContain('Maya Chen');
        expect(row!.status).toBe('storyboard');
        expect(origin.story).toMatchObject({
          kind: 'external',
          clientName: 'contract test',
        });
        expect(origin.screenplay).toMatchObject({ kind: 'external' });

        const screenplayRun = runs.find((r) => r.stage === 'screenplay')!;
        expect(screenplay.scenes).toHaveLength(screenplayRun.parts.length);
        expect(screenplayRun.parts).toEqual(
          screenplay.scenes.map((_, i) => `scene-${i + 1}`),
        );
      },
    );

    it('screenplay: dialogue_lines are rebuilt from the scenes, numbered across them', async () => {
      const lines = await admin(
        `/rest/v1/dialogue_lines?episode_id=eq.${episodeId}&language=eq.en&select=scene_number,sequence_number,text,character_asset_id&order=sequence_number`,
      );
      const scenes = runs.find((r) => r.stage === 'screenplay')!.parts.length;

      expect(lines).toHaveLength(scenes * 2);
      expect(lines.map((l) => l.sequence_number)).toEqual(
        lines.map((_, i) => i + 1),
      );
      expect(lines[0]).toMatchObject({
        scene_number: 1,
        text: 'Signal 1. It is my voice.',
        character_asset_id: mayaId,
      });
    });

    it('shots: reel_scout, then one part per scene, numbered in order across scenes; the flagged scene is the reel', async () => {
      const shotsRun = runs.find((r) => r.stage === 'shots')!;
      const scenes = runs.find((r) => r.stage === 'screenplay')!.parts.length;

      expect(shotsRun.parts).toEqual([
        'reel_scout',
        ...Array.from({ length: scenes }, (_, i) => `scene:${i + 1}`),
      ]);

      const shots = await admin(
        `/rest/v1/shots?episode_id=eq.${episodeId}&deleted_at=is.null&select=scene_number,shot_number,sequence_number,shorts_candidate,generation_origin&order=sequence_number`,
      );
      const perScene = shots.length / scenes;

      expect(Number.isInteger(perScene)).toBe(true);
      expect(shots.map((s) => s.shot_number)).toEqual(
        shots.map((_, i) => i + 1),
      );
      expect(shots.map((s) => s.scene_number)).toEqual(
        shots.map((_, i) => Math.floor(i / perScene) + 1),
      );
      expect(
        shots.filter((s) => s.shorts_candidate).map((s) => s.scene_number),
      ).toEqual(Array(perScene).fill(1));
      expect(shots[0]!.generation_origin).toMatchObject({
        kind: 'external',
        runId: shotsRun.runId,
      });
    });

    it('audio cues: the shots commit opened an external child run, never a queued job, and its commit wrote the cues', async () => {
      const shotsRun = runs.find((r) => r.stage === 'shots')!;
      const [child] = await admin(
        `/rest/v1/generation_runs?id=eq.${audioChild.runId}&select=stage,mode,status,parent_run_id,connection_id`,
      );

      expect(child).toMatchObject({
        stage: 'audio_cues',
        mode: 'external',
        status: 'committed',
        parent_run_id: shotsRun.runId,
      });

      const jobs = await admin(
        `/rest/v1/generation_jobs?reference_id=eq.${episodeId}&select=job_type,status`,
      );
      expect(jobs).toEqual([]);

      const cues = await admin(
        `/rest/v1/audio_cues?episode_id=eq.${episodeId}&select=cue_type,generation_origin`,
      );
      const scenes = runs.find((r) => r.stage === 'screenplay')!.parts.length;
      expect(cues).toHaveLength(scenes * 2);
      expect(cues[0]!.generation_origin).toMatchObject({ kind: 'external' });
    });

    it(
      'every other registered stage completes too, season_outline last',
      { timeout: 300_000 },
      async () => {
        runs.push(
          ...(await driveRemainingStages(call, { ...ids(), assetId: mayaId })),
        );

        const driven = new Set(runs.map((run) => run.stage));
        expect([...driven].sort()).toEqual(
          ALL_STAGES.map((stage) => stage.key).sort(),
        );

        const committed = await admin(
          `/rest/v1/generation_runs?id=in.(${runs.map((r) => r.runId).join(',')})&select=stage,mode,status`,
        );
        expect(committed).toHaveLength(runs.length);
        for (const run of committed) {
          expect(run, String(run.stage)).toMatchObject({
            mode: 'external',
            status: 'committed',
          });
        }
      },
    );

    it('their results are where the web reads them', async () => {
      const [episode] = await admin(
        `/rest/v1/episodes?id=eq.${episodeId}&select=story_data,screenplay_data,metadata`,
      );
      expect((episode!.story_data as Row).fullStory).toContain(
        'nobody answers but her',
      );
      expect(
        ((episode!.screenplay_data as Row).scenes as Row[])[0]!.description,
      ).toBe('Maya listens, calmer now.');

      const [maya] = await admin(
        `/rest/v1/assets?id=eq.${mayaId}&select=description`,
      );
      expect(maya!.description).toContain('close-cropped grey hair');

      const facts = await admin(
        `/rest/v1/verified_facts?project_id=eq.${team.projectId}&select=claim`,
      );
      expect(facts).toEqual([{ claim: 'The relay station orbits at 400 km.' }]);

      const [project] = await admin(
        `/rest/v1/projects?id=eq.${team.projectId}&select=metadata`,
      );
      expect((project!.metadata as Row).latestSeasonAnalysis).toBeTruthy();

      const translated = await admin(
        `/rest/v1/dialogue_lines?episode_id=eq.${episodeId}&language=eq.es&select=text`,
      );
      const english = await admin(
        `/rest/v1/dialogue_lines?episode_id=eq.${episodeId}&language=eq.en&select=id`,
      );
      expect(translated).toHaveLength(english.length);
      expect(String(translated[0]!.text)).toMatch(/^ES: /);

      const outlined = await admin(
        `/rest/v1/episodes?project_id=eq.${team.projectId}&number=eq.9&select=title`,
      );
      expect(outlined).toEqual([{ title: 'The Relay' }]);

      const publish = runs.find((r) => r.stage === 'publish_metadata')!;
      expect(
        (publish.finalized.commit as { data: { items: Row[] } }).data.items[0],
      ).toMatchObject({ translatedTitle: 'La última señal' });
    });

    it('no stage made a model call: no llm_usage_analytics row for the team', async () => {
      const rows = await admin(
        `/rest/v1/llm_usage_analytics?account_id=eq.${team.accountId}&created_at=gte.${encodeURIComponent(startedAt)}&select=id`,
      );

      expect(rows).toEqual([]);
    });

    it(
      'edit_scene, edit_shot and edit_dialogue_line commit through the run layer: versioned, snapshotted, stamped external',
      { timeout: 300_000 },
      async () => {
        const version = async () =>
          Number(
            (
              await admin(`/rest/v1/episodes?id=eq.${episodeId}&select=version`)
            )[0]!.version,
          );

        const scene = await call('edit_scene', {
          episodeId,
          version: await version(),
          sceneNumber: 2,
          heading: 'INT. OBSERVATION DECK - DAWN',
          timeOfDay: 'dawn',
        });
        expect(
          scene.isError,
          JSON.stringify(scene.structuredContent),
        ).toBeFalsy();
        const sceneRunId = scene.structuredContent!.runId as string;

        const [shot] = await admin(
          `/rest/v1/shots?episode_id=eq.${episodeId}&scene_number=eq.1&select=id,prompt&order=sequence_number&limit=1`,
        );
        const edited = await call('edit_shot', {
          episodeId,
          version: await version(),
          shotId: shot!.id,
          durationSeconds: 6,
          veoPrompt: {
            fullPrompt: 'Close on Maya at the console, dawn light.',
          },
        });
        expect(
          edited.isError,
          JSON.stringify(edited.structuredContent),
        ).toBeFalsy();

        const [line] = await admin(
          `/rest/v1/dialogue_lines?episode_id=eq.${episodeId}&language=eq.en&sequence_number=eq.1&select=id`,
        );
        const lineEdit = await call('edit_dialogue_line', {
          episodeId,
          version: await version(),
          dialogueLineId: line!.id,
          text: 'It is my voice. It is me.',
        });
        expect(
          lineEdit.isError,
          JSON.stringify(lineEdit.structuredContent),
        ).toBeFalsy();

        const stale = await call('edit_dialogue_line', {
          episodeId,
          version: (await version()) - 1,
          dialogueLineId: line!.id,
          text: 'too late',
        });
        expect(stale.structuredContent).toMatchObject({
          code: 'TARGET_CHANGED',
        });

        const [episode] = await admin(
          `/rest/v1/episodes?id=eq.${episodeId}&select=screenplay_data`,
        );
        const scenes = (episode!.screenplay_data as { scenes: Row[] }).scenes;
        expect(scenes[1]).toMatchObject({
          heading: 'INT. OBSERVATION DECK - DAWN',
          timeOfDay: 'dawn',
          generationOrigin: { kind: 'external', runId: sceneRunId },
        });
        expect((scenes[0]!.dialogue as Row[])[0]!.text).toBe(
          'It is my voice. It is me.',
        );

        const [shotAfter] = await admin(
          `/rest/v1/shots?id=eq.${shot!.id}&select=prompt,duration_seconds,generation_origin`,
        );
        expect(shotAfter).toMatchObject({
          prompt: 'Close on Maya at the console, dawn light.',
          duration_seconds: 6,
          generation_origin: { kind: 'external' },
        });

        const [lineAfter] = await admin(
          `/rest/v1/dialogue_lines?id=eq.${line!.id}&select=text,sequence_number`,
        );
        expect(lineAfter).toMatchObject({
          text: 'It is my voice. It is me.',
          sequence_number: 1,
        });

        const editRuns = await admin(
          `/rest/v1/generation_runs?id=in.(${[sceneRunId, edited.structuredContent!.runId, lineEdit.structuredContent!.runId].join(',')})&select=stage,mode,status,origin`,
        );
        expect(editRuns.map((r) => [r.stage, r.mode, r.status]).sort()).toEqual(
          [
            ['screenplay_refinement', 'external', 'committed'],
            ['screenplay_refinement', 'external', 'committed'],
            ['shots', 'external', 'committed'],
          ].sort(),
        );

        const revisions = await admin(
          `/rest/v1/content_revisions?run_id=eq.${edited.structuredContent!.runId}&select=snapshot`,
        );
        expect(
          (revisions[0]!.snapshot as { shots: Row[] }).shots.find(
            (s) => s.id === shot!.id,
          )!.prompt,
        ).toBe(shot!.prompt);
      },
    );
  },
);
