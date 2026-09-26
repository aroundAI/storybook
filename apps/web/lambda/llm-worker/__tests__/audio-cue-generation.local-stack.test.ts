/**
 * KB-92: an episode with one sceneless shot still gets all its audio cues —
 * run for real against the local stack.
 *
 * `audio-cue-generation.test.ts` proves the handler passes the null through,
 * on a fake client, in CI. It cannot prove that the database takes it: under
 * the old NOT NULL, the one insert failed and the episode got no cue at all.
 * This runs the handler with the local service role — what the llm-worker
 * Lambda uses — and reads the rows back. The orchestrator (an LLM call) and
 * the job bookkeeping are mocked; the insert is real.
 *
 * Requests go through `node:http`, not the test environment's `fetch`
 * (happy-dom's, which applies browser CORS rules to a request to :54321).
 *
 * Off unless asked for: it needs the local Supabase and its service role,
 * under names of their own, because `vitest.setup.ts` overwrites
 * `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` with dummies.
 *
 *   set -a; . deployment/config/local.env; set +a
 *   CUES_LOCAL_STACK_URL=$NEXT_PUBLIC_SUPABASE_URL \
 *   CUES_LOCAL_STACK_KEY=$SUPABASE_SERVICE_ROLE_KEY \
 *     pnpm --filter web exec vitest run audio-cue-generation.local-stack
 */
import { type SupabaseClient, createClient } from '@supabase/supabase-js';

import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Database } from '@kit/supabase/database';

import { processAudioCueGeneration } from '../handlers/audio-cue-generation';

const TAG = `kb92-${Date.now()}`;
const LOCAL_STACK_URL = process.env.CUES_LOCAL_STACK_URL;
const LOCAL_STACK_KEY = process.env.CUES_LOCAL_STACK_KEY;

vi.mock('../utils/job-tracking', () => ({
  markJobProcessing: vi.fn(),
  markJobCompleted: vi.fn(),
  markJobFailed: vi.fn(),
}));

vi.mock('@kit/episodes/agent/audio-cue-orchestrator', () => ({
  runAudioCueOrchestrator: async () => ({
    success: true,
    orchestratorSteps: 1,
    coveragePercent: 100,
    cues: [1, 2, 3].map((seq) => ({
      type: 'sfx',
      prompt: `${TAG} cue on shot ${seq}`,
      startShotSequence: seq,
      startOffsetInShot: 0,
      durationSeconds: 2,
    })),
  }),
}));

function nodeFetch(input: RequestInfo | URL, init?: RequestInit) {
  const url = new URL(input instanceof Request ? input.url : input);
  const headers = Object.fromEntries(new Headers(init?.headers).entries());

  return new Promise<Response>((resolve, reject) => {
    const outgoing = request(
      url,
      { method: init?.method ?? 'GET', headers },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
        incoming.on('end', () => {
          const status = incoming.statusCode ?? 500;
          const body = Buffer.concat(chunks).toString();
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(incoming.headers)) {
            if (typeof value === 'string') responseHeaders.set(name, value);
          }
          resolve(
            new Response(status === 204 ? null : body, {
              status,
              headers: responseHeaders,
            }),
          );
        });
      },
    );
    outgoing.on('error', reject);
    if (typeof init?.body === 'string') outgoing.write(init.body);
    outgoing.end();
  });
}

describe.skipIf(!LOCAL_STACK_URL || !LOCAL_STACK_KEY)(
  'audio cue generation against the local database (KB-92)',
  () => {
    let supabase: SupabaseClient<Database>;
    let episodeId: string;

    beforeAll(async () => {
      supabase = createClient<Database>(LOCAL_STACK_URL!, LOCAL_STACK_KEY!, {
        auth: { persistSession: false },
        global: { fetch: nodeFetch },
      });

      const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('id')
        .limit(1)
        .single();
      if (projectError) throw projectError;

      const { data: episode, error: episodeError } = await supabase
        .from('episodes')
        .insert({
          project_id: project.id,
          number: 90_000 + Math.floor(Math.random() * 9_000),
          title: `${TAG} episode`,
        })
        .select('id')
        .single();
      if (episodeError) throw episodeError;
      episodeId = episode.id;

      const { error: shotsError } = await supabase.from('shots').insert(
        [1, 2, 3].map((seq) => ({
          episode_id: episodeId,
          sequence_number: seq,
          scene_number: seq === 2 ? null : seq,
          duration_seconds: 4,
          scene_description: `${TAG} shot ${seq}`,
          prompt: `${TAG} shot ${seq}`,
        })),
      );
      if (shotsError) throw shotsError;
    });

    afterAll(async () => {
      if (!supabase || !episodeId) return;
      await supabase.from('audio_cues').delete().eq('episode_id', episodeId);
      await supabase.from('shots').delete().eq('episode_id', episodeId);
      await supabase.from('episodes').delete().eq('id', episodeId);
    });

    it('saves every cue, the one on the sceneless shot with no scene', async () => {
      const result = await processAudioCueGeneration(
        { episodeId, projectId: 'p', accountId: 'a' },
        supabase,
      );

      expect(result).toEqual({ success: true, cuesCreated: 3 });

      const { data: cues, error } = await supabase
        .from('audio_cues')
        .select('prompt, scene_number')
        .eq('episode_id', episodeId)
        .order('start_offset_seconds');
      if (error) throw error;

      expect(cues).toEqual([
        { prompt: `${TAG} cue on shot 1`, scene_number: 1 },
        { prompt: `${TAG} cue on shot 2`, scene_number: null },
        { prompt: `${TAG} cue on shot 3`, scene_number: 3 },
      ]);
    });
  },
);
