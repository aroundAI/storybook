import { describe, expect, it, vi } from 'vitest';

import * as webStarts from '@kit/audio-generation/server/render-starts';
import { buildOpenClawManifest } from '@kit/episodes/lib/openclaw-manifest';
import { shotFromRow } from '@kit/episodes/lib/shot-row';

import { McpToolError } from '../../src/errors';
import type { McpToolDefinition } from '../../src/registry';
import { defaultTools } from '../../src/server/tools';
import {
  type RenderStartDeps,
  createRenderStartTools,
  getRenderStatusTool,
  getVeoManifestTool,
  webRenderStarts,
} from '../../src/server/tools/render';
import { type FakeDb, contextFor, fakeClient } from '../helpers/fake-postgrest';

/**
 * FILM-1909's render tools: start_voice_render and start_audio_render call
 * the web's own render starts with the principal's client, scoped to the
 * bound team and to the episode named; get_render_status reads where the
 * renders stand; get_veo_manifest returns the visual studio's export.
 */
const TEAM = { id: '22222222-2222-4222-8222-222222222222', slug: 'team-a' };
const OTHER = '99999999-9999-4999-8999-999999999999';
const PROJECT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EPISODE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER_EPISODE = 'bbbbbbbb-bbbb-4bbb-8bbb-000000000002';
const LINE = 'dddddddd-dddd-4ddd-8ddd-000000000001';
const CUE = 'ffffffff-ffff-4fff-8fff-000000000001';

function episode(id: string, accountId: string) {
  return {
    id,
    title: id === EPISODE ? 'Toast' : 'Elsewhere',
    deleted_at: null,
    project: { id: PROJECT, account_id: accountId, name: 'P', slug: 'p' },
  };
}

function db(extra: FakeDb = {}): FakeDb {
  return {
    episodes: [episode(EPISODE, TEAM.id), episode(OTHER_EPISODE, OTHER)],
    dialogue_lines: [{ id: LINE, episode_id: EPISODE }],
    audio_cues: [{ id: CUE, episode_id: EPISODE }],
    ...extra,
  };
}

function fakeStarts(overrides: Partial<RenderStartDeps> = {}) {
  return {
    startDialogueVoiceRender: vi.fn(async () => ({
      success: true,
      status: 'queued' as const,
    })),
    startEpisodeVoiceRender: vi.fn(async () => ({
      batchJobId: 'batch-1',
      episodeId: EPISODE,
      totalLines: 4,
      estimatedCost: 0.12,
      estimatedDuration: 10,
      status: 'queued' as const,
    })),
    startCueAudioRender: vi.fn(async () => ({
      success: true,
      status: 'queued' as const,
    })),
    ...overrides,
  } as RenderStartDeps &
    Record<keyof RenderStartDeps, ReturnType<typeof vi.fn>>;
}

function setup(starts = fakeStarts(), extra: FakeDb = {}) {
  const client = fakeClient(db(extra));
  const context = contextFor(client, TEAM, ['studio:read', 'studio:render']);
  const tools = createRenderStartTools(starts);

  return { client, context, tools, starts };
}

async function refusal(promise: Promise<unknown>) {
  const error = await promise.then(
    () => {
      throw new Error('expected a refusal');
    },
    (e: unknown) => e,
  );

  expect(error).toBeInstanceOf(McpToolError);

  return error as McpToolError;
}

describe('the render tools in the default list', () => {
  const byName = new Map(defaultTools.map((tool) => [tool.name, tool]));

  it.each([
    ['start_voice_render', 'studio:render', false],
    ['start_audio_render', 'studio:render', false],
    ['get_render_status', 'studio:render', true],
    ['get_veo_manifest', 'studio:read', true],
  ] as const)('%s needs %s (read-only %s)', (name, scope, readOnly) => {
    const tool = byName.get(name) as McpToolDefinition;

    expect(tool.scope).toBe(scope);
    expect(tool.annotations.readOnlyHint).toBe(readOnly);
  });

  it('start the web’s own render starts, not a copy of them', () => {
    expect(webRenderStarts.startDialogueVoiceRender).toBe(
      webStarts.startDialogueVoiceRender,
    );
    expect(webRenderStarts.startEpisodeVoiceRender).toBe(
      webStarts.startEpisodeVoiceRender,
    );
    expect(webRenderStarts.startCueAudioRender).toBe(
      webStarts.startCueAudioRender,
    );
  });
});

describe('start_voice_render', () => {
  it('starts one line through the web core with the principal’s client and user', async () => {
    const { context, tools, starts } = setup();

    const result = await tools.startVoiceRenderTool.handler(
      { episodeId: EPISODE, dialogueLineId: LINE, voiceId: 'v-1' },
      context,
    );

    expect(starts.startDialogueVoiceRender).toHaveBeenCalledWith(
      context.principal.supabase,
      context.principal.userId,
      { dialogueLineId: LINE, voiceId: 'v-1', overwriteExisting: undefined },
    );
    expect(result.structuredContent).toMatchObject({
      status: 'queued',
      scope: 'line',
    });
  });

  it('starts the whole episode through the batch core', async () => {
    const { context, tools, starts } = setup();

    const result = await tools.startVoiceRenderTool.handler(
      { episodeId: EPISODE, overwriteExisting: true },
      context,
    );

    expect(starts.startEpisodeVoiceRender).toHaveBeenCalledWith(
      context.principal.supabase,
      context.principal.userId,
      {
        episodeId: EPISODE,
        voiceAssignments: undefined,
        overwriteExisting: true,
      },
    );
    expect(result.structuredContent).toMatchObject({
      batchJobId: 'batch-1',
      totalLines: 4,
      estimatedCost: 0.12,
    });
  });

  it('refuses an episode of another team, and a line of another episode, before any render starts', async () => {
    const { context, tools, starts } = setup(fakeStarts(), {
      dialogue_lines: [{ id: LINE, episode_id: OTHER_EPISODE }],
    });

    const otherTeam = await refusal(
      tools.startVoiceRenderTool.handler({ episodeId: OTHER_EPISODE }, context),
    );
    expect(otherTeam.code).toBe('NOT_FOUND');

    const otherLine = await refusal(
      tools.startVoiceRenderTool.handler(
        { episodeId: EPISODE, dialogueLineId: LINE },
        context,
      ),
    );
    expect(otherLine.code).toBe('NOT_FOUND');

    expect(starts.startDialogueVoiceRender).not.toHaveBeenCalled();
    expect(starts.startEpisodeVoiceRender).not.toHaveBeenCalled();
  });

  it('turns the core’s refusals into the contract: a refusal as VALIDATION_FAILED, a queue fault as INTERNAL', async () => {
    const refusalCore = setup(
      fakeStarts({
        startDialogueVoiceRender: vi.fn(async () => ({
          success: false,
          status: 'failed' as const,
          error:
            'No voice ID provided and character has no voice profile configured',
        })),
      }),
    );
    const refused = await refusal(
      refusalCore.tools.startVoiceRenderTool.handler(
        { episodeId: EPISODE, dialogueLineId: LINE },
        refusalCore.context,
      ),
    );
    expect(refused.code).toBe('VALIDATION_FAILED');
    expect(refused.message).toContain('no voice profile');

    const faultCore = setup(
      fakeStarts({
        startDialogueVoiceRender: vi.fn(async () => ({
          success: false,
          status: 'failed' as const,
          error: 'VOICE_QUEUE_URL not configured',
        })),
      }),
    );
    const fault = await refusal(
      faultCore.tools.startVoiceRenderTool.handler(
        { episodeId: EPISODE, dialogueLineId: LINE },
        faultCore.context,
      ),
    );
    expect(fault.code).toBe('INTERNAL');
    expect(fault.message).not.toContain('VOICE_QUEUE_URL');

    const batchRefusal = new Error(
      'Missing voice assignments for 1 character(s).',
    );
    batchRefusal.name = 'ActionRefusal';
    const batchCore = setup(
      fakeStarts({
        startEpisodeVoiceRender: vi.fn(async () => {
          throw batchRefusal;
        }),
      }),
    );
    const batch = await refusal(
      batchCore.tools.startVoiceRenderTool.handler(
        { episodeId: EPISODE },
        batchCore.context,
      ),
    );
    expect(batch.code).toBe('VALIDATION_FAILED');
    expect(batch.message).toBe(batchRefusal.message);
  });
});

describe('start_audio_render', () => {
  it('starts a cue of the episode through the web core', async () => {
    const { context, tools, starts } = setup();

    await tools.startAudioRenderTool.handler(
      { episodeId: EPISODE, cueId: CUE },
      context,
    );

    expect(starts.startCueAudioRender).toHaveBeenCalledWith(
      context.principal.supabase,
      context.principal.userId,
      CUE,
    );
  });

  it('refuses a cue of another episode', async () => {
    const { context, tools, starts } = setup(fakeStarts(), {
      audio_cues: [{ id: CUE, episode_id: OTHER_EPISODE }],
    });

    const error = await refusal(
      tools.startAudioRenderTool.handler(
        { episodeId: EPISODE, cueId: CUE },
        context,
      ),
    );

    expect(error.code).toBe('NOT_FOUND');
    expect(starts.startCueAudioRender).not.toHaveBeenCalled();
  });
});

describe('get_render_status', () => {
  it('counts lines and cues by status and lists the ones still rendering or failed', async () => {
    const client = fakeClient(
      db({
        dialogue_lines: [
          {
            id: 'l1',
            episode_id: EPISODE,
            status: 'completed',
            audio_url: 'a',
            scene_number: 1,
            sequence_number: 1,
            language: 'en',
          },
          {
            id: 'l2',
            episode_id: EPISODE,
            status: 'generating',
            audio_url: null,
            scene_number: 1,
            sequence_number: 2,
            language: 'en',
          },
          {
            id: 'l3',
            episode_id: EPISODE,
            status: 'failed',
            audio_url: null,
            scene_number: 2,
            sequence_number: 3,
            language: 'en',
          },
          {
            id: 'x',
            episode_id: OTHER_EPISODE,
            status: 'failed',
            audio_url: null,
            scene_number: 1,
            sequence_number: 1,
            language: 'en',
          },
        ],
        audio_cues: [
          {
            id: 'c1',
            episode_id: EPISODE,
            status: 'placed',
            cue_type: 'music',
            scene_number: 1,
            audio_track_id: 't1',
          },
          {
            id: 'c2',
            episode_id: EPISODE,
            status: 'generating',
            cue_type: 'sfx',
            scene_number: 2,
            audio_track_id: null,
          },
        ],
        batch_generation_jobs: [
          {
            id: 'b1',
            episode_id: EPISODE,
            status: 'processing',
            total_lines: 3,
            completed_lines: 1,
            failed_lines: 1,
            estimated_cost: 0.1,
            actual_cost: 0.03,
            errors: [],
            started_at: null,
            completed_at: null,
            created_at: '2026-10-03',
          },
        ],
      }),
    );

    const result = await getRenderStatusTool.handler(
      { episodeId: EPISODE },
      contextFor(client, TEAM, ['studio:render']),
    );

    expect(result.structuredContent).toMatchObject({
      voice: {
        totalLines: 3,
        withAudio: 1,
        byStatus: { completed: 1, generating: 1, failed: 1 },
        inFlightOrFailed: [
          { id: 'l2', status: 'generating' },
          { id: 'l3', status: 'failed' },
        ],
        batch: { batchJobId: 'b1', completedLines: 1, failedLines: 1 },
      },
      audio: {
        totalCues: 2,
        placed: 1,
        byStatus: { placed: 1, generating: 1 },
        inFlightOrFailed: [{ id: 'c2', type: 'sfx' }],
      },
    });
  });
});

describe('get_veo_manifest', () => {
  const veo = (n: number) => ({
    shotLine: 'SHOT',
    timeline: [],
    audio: 'AUDIO',
    style: 'STYLE',
    avoid: 'AVOID',
    fullPrompt: `VEO prompt ${n}`,
  });

  function shot(n: number, scene: number, extra: Record<string, unknown> = {}) {
    return {
      id: `s${n}`,
      episode_id: EPISODE,
      scene_number: scene,
      shot_number: n,
      sequence_number: n,
      duration_seconds: 5,
      scene_description: `Shot ${n}`,
      action_description: null,
      prompt: `prompt ${n}`,
      camera_direction: 'static',
      status: 'pending',
      video_url: null,
      thumbnail_url: null,
      first_frame_url: null,
      last_frame_url: null,
      generation_job_id: null,
      generation_metadata: {
        characters: ['Mara'],
        location: 'Kitchen',
        veoPrompt: veo(n),
      },
      shorts_candidate: false,
      shorts_metadata: null,
      transition_type: 'cut',
      continuation_from_shot_id: null,
      inherit_last_frame: false,
      first_frame_description: `first frame ${n}`,
      last_frame_description: `last frame ${n}`,
      first_frame_source: null,
      location_area: 'counter',
      location_environment_description: 'A small kitchen.',
      primary_subject: { type: 'character', name: 'Mara' },
      frame_strategy: 'character_focus',
      created_at: '2026-10-03',
      updated_at: '2026-10-03',
      deleted_at: null,
      ...extra,
    };
  }

  const asset = (id: string, type: string, name: string) => ({
    id,
    project_id: PROJECT,
    type,
    name,
    file_url: `https://img/${name}.png`,
    deleted_at: null,
  });

  it('is the manifest the visual studio exports, with the VEO prompt and frame descriptions per shot, paged by scene', async () => {
    const shots = [
      shot(1, 1),
      shot(2, 1),
      shot(3, 2),
      shot(4, 3, { deleted_at: '2026-10-01' }),
    ];
    const assets = [
      asset('a1', 'character', 'Mara'),
      asset('a2', 'location', 'Kitchen'),
      asset('a3', 'prop', 'Toaster'),
      { ...asset('a4', 'character', 'Ghost'), deleted_at: '2026-10-01' },
    ];
    const client = fakeClient(db({ shots, assets }));
    const context = contextFor(client, TEAM, ['studio:read']);

    const first = await getVeoManifestTool.handler(
      { episodeId: EPISODE, limit: 1 },
      context,
    );
    const content = first.structuredContent as Record<string, unknown> & {
      shots: Array<Record<string, unknown>>;
      nextCursor: string | null;
    };

    const live = shots.filter((s) => !s.deleted_at);
    const web = buildOpenClawManifest(
      {
        id: EPISODE,
        title: 'Toast',
        projectId: PROJECT,
        shots: live.map((s) => shotFromRow(s as never)),
      },
      [
        {
          ...asset('a1', 'character', 'Mara'),
          fileUrl: 'https://img/Mara.png',
        } as never,
      ],
      [
        {
          ...asset('a2', 'location', 'Kitchen'),
          fileUrl: 'https://img/Kitchen.png',
        } as never,
      ],
    );

    expect(content.summary).toEqual(web.summary);
    expect(content.episode).toEqual(web.episode);
    expect(content.shots).toEqual(web.shots.filter((s) => s.scene === 1));
    expect(content.shots[0]).toMatchObject({
      veoPrompt: 'VEO prompt 1',
      firstFrameDescription: 'first frame 1',
      lastFrameDescription: 'last frame 1',
      ingredients: {
        characters: [{ name: 'Mara', imageUrl: 'https://img/Mara.png' }],
        location: { name: 'Kitchen', imageUrl: 'https://img/Kitchen.png' },
      },
    });
    expect(content.nextCursor).not.toBeNull();

    const second = await getVeoManifestTool.handler(
      { episodeId: EPISODE, limit: 1, cursor: content.nextCursor! },
      context,
    );
    expect(
      (second.structuredContent.shots as Array<{ shotId: string }>).map(
        (s) => s.shotId,
      ),
    ).toEqual(['s3']);
    expect(second.structuredContent.nextCursor).toBeNull();
  });

  it('refuses an episode of another team', async () => {
    const client = fakeClient(db());
    const error = await refusal(
      getVeoManifestTool.handler(
        { episodeId: OTHER_EPISODE, limit: 20 },
        contextFor(client, TEAM, ['studio:read']),
      ),
    );

    expect(error.code).toBe('NOT_FOUND');
  });
});
