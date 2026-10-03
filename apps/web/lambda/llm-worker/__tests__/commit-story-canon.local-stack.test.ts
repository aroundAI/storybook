/**
 * KB-78: regenerating a story must replace the canon generation made and keep
 * the canon a person added — run for real against the local stack.
 *
 * `commit-story-canon.test.ts` proves the rule on a fake client, in CI. It
 * cannot prove that PostgREST reads `metadata->>auto_generated` the way the
 * fake does, or that `narrative_threads.auto_generated` exists with the
 * default the rule relies on. This runs the real functions with the local
 * service role — what the llm-worker Lambda uses — and reads the rows back.
 *
 * Requests go through `node:http`, not the test environment's `fetch`
 * (happy-dom's, which applies browser CORS rules to a request to :54321).
 *
 * Off unless asked for: it needs the local Supabase and its service role,
 * under names of their own, because `vitest.setup.ts` overwrites
 * `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` with dummies.
 *
 *   set -a; . deployment/config/local.env; set +a
 *   CANON_LOCAL_STACK_URL=$NEXT_PUBLIC_SUPABASE_URL \
 *   CANON_LOCAL_STACK_KEY=$SUPABASE_SERVICE_ROLE_KEY \
 *     pnpm --filter web exec vitest run commit-story-canon.local-stack
 */
import { type SupabaseClient, createClient } from '@supabase/supabase-js';

import { request } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type CanonExtraction,
  cleanupEpisodeCanon,
  commitStoryCanon,
} from '@kit/generation/canon';

const TAG = `kb78-${Date.now()}`;
const LOCAL_STACK_URL = process.env.CANON_LOCAL_STACK_URL;
const LOCAL_STACK_KEY = process.env.CANON_LOCAL_STACK_KEY;

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
  'story regeneration against the local database',
  () => {
    let supabase: SupabaseClient;
    let projectId: string;
    let episodeId: string;
    let characterId: string;
    let userId: string;

    beforeAll(async () => {
      supabase = createClient(LOCAL_STACK_URL!, LOCAL_STACK_KEY!, {
        auth: { persistSession: false },
        global: { fetch: nodeFetch },
      });

      const { data: project, error: projectError } = await supabase
        .from('projects')
        .select('id')
        .limit(1)
        .single();
      if (projectError) throw projectError;
      projectId = project.id;

      const { data: owner, error: ownerError } = await supabase
        .from('accounts')
        .select('id')
        .eq('is_personal_account', true)
        .limit(1)
        .single();
      if (ownerError) throw ownerError;
      userId = owner.id;

      const { data: episode, error: episodeError } = await supabase
        .from('episodes')
        .insert({
          project_id: projectId,
          number: 90_000 + Math.floor(Math.random() * 9_000),
          title: `${TAG} episode`,
        })
        .select('id')
        .single();
      if (episodeError) throw episodeError;
      episodeId = episode.id;

      const { data: character, error: characterError } = await supabase
        .from('assets')
        .insert({
          project_id: projectId,
          type: 'character',
          name: `${TAG} Mara`,
        })
        .select('id')
        .single();
      if (characterError) throw characterError;
      characterId = character.id;
    });

    afterAll(async () => {
      if (!supabase) return;
      await supabase
        .from('narrative_threads')
        .delete()
        .eq('opened_at', episodeId);
      await supabase
        .from('character_states')
        .delete()
        .eq('episode_id', episodeId);
      await supabase
        .from('immutable_events')
        .delete()
        .eq('established_in', episodeId);
      await supabase.from('episodes').delete().eq('id', episodeId);
      await supabase.from('assets').delete().eq('id', characterId);
    });

    async function insertEvent(
      key: string,
      metadata: Record<string, unknown> | null,
    ) {
      const { error } = await supabase.from('immutable_events').insert({
        project_id: projectId,
        event_type: 'world_fact',
        event_key: `${TAG}-${key}`,
        established_in: episodeId,
        season: 1,
        episode_number: 1,
        description: key,
        metadata,
      });
      if (error) throw error;
    }

    async function eventKeys() {
      const { data, error } = await supabase
        .from('immutable_events')
        .select('event_key')
        .eq('established_in', episodeId)
        .order('event_key');
      if (error) throw error;
      return data.map((row) => row.event_key.replace(`${TAG}-`, ''));
    }

    async function threadNames() {
      const { data, error } = await supabase
        .from('narrative_threads')
        .select('thread_name')
        .eq('opened_at', episodeId)
        .order('thread_name');
      if (error) throw error;
      return data.map((row) => row.thread_name);
    }

    it('keeps events added by hand and deletes the generated ones', async () => {
      await insertEvent('manual-null-metadata', null);
      await insertEvent('manual-other-metadata', { note: 'from the writer' });
      await insertEvent('generated', {
        auto_generated: true,
        source: 'story_generation',
      });

      await cleanupEpisodeCanon(episodeId, supabase);

      expect(await eventKeys()).toEqual([
        'manual-null-metadata',
        'manual-other-metadata',
      ]);
    });

    it('keeps character states added by hand and deletes the generated ones', async () => {
      const { error } = await supabase.from('character_states').insert([
        {
          character_id: characterId,
          episode_id: episodeId,
          state_type: 'goal',
          state_value: { note: 'hand' },
          trigger_event: 'Writer: Mara swears revenge',
        },
        {
          character_id: characterId,
          episode_id: episodeId,
          state_type: 'goal',
          state_value: { note: 'generated' },
          trigger_event: 'story_generation',
        },
      ]);
      if (error) throw error;

      await cleanupEpisodeCanon(episodeId, supabase);

      const { data } = await supabase
        .from('character_states')
        .select('trigger_event')
        .eq('episode_id', episodeId);
      expect(data?.map((row) => row.trigger_event)).toEqual([
        'Writer: Mara swears revenge',
      ]);
    });

    it('keeps a thread added by hand, which carries no marker', async () => {
      const { error } = await supabase.from('narrative_threads').insert({
        project_id: projectId,
        thread_name: `${TAG} hand thread`,
        thread_type: 'plot',
        opened_at: episodeId,
        status: 'open',
      });
      if (error) throw error;

      await cleanupEpisodeCanon(episodeId, supabase);

      expect(await threadNames()).toEqual([`${TAG} hand thread`]);
    });

    it('marks the threads it generates, and replaces only those on the next regeneration', async () => {
      // The canon facts the story came with (FILM-1901: the worker's generate
      // step extracts them; here they are given directly)
      const extraction: CanonExtraction = {
        threadUpdates: [
          {
            threadName: `${TAG} generated thread`,
            threadType: 'mystery',
            action: 'open',
            description: 'Who poisoned the well?',
          },
        ],
        episodeSummary: '',
        sentimentScore: 0.5,
      };

      const regenerate = () =>
        commitStoryCanon({
          projectId,
          episodeId,
          episodeNumber: 1,
          season: 1,
          keyEvents: [`${TAG} the well is poisoned`],
          characters: [{ name: `${TAG} Mara`, role: 'lead', arc: 'revenge' }],
          extraction,
          createdBy: userId,
          supabase,
        });

      await regenerate();

      const { data: generated } = await supabase
        .from('narrative_threads')
        .select('thread_name, auto_generated')
        .eq('opened_at', episodeId)
        .eq('thread_name', `${TAG} generated thread`);
      expect(generated).toEqual([
        { thread_name: `${TAG} generated thread`, auto_generated: true },
      ]);

      await regenerate();

      expect(await threadNames()).toEqual([
        `${TAG} generated thread`,
        `${TAG} hand thread`,
      ]);
      expect(await eventKeys()).toEqual([
        'manual-null-metadata',
        'manual-other-metadata',
        'the-well-is-poisoned-ep1',
      ]);

      const { data: states } = await supabase
        .from('character_states')
        .select('trigger_event')
        .eq('episode_id', episodeId);
      expect(states?.map((row) => row.trigger_event).sort()).toEqual([
        'Writer: Mara swears revenge',
        'story_generation',
      ]);
    });
  },
);
