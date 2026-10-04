import { createClient } from '@supabase/supabase-js';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { randomUUID, webcrypto } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FIXTURES, seedFixture } from '@kit/desktop-integration/fixtures';
import { currentEditPackageEtag } from '@kit/desktop-integration/server';

import { shotsOutput } from '../../generation/src/testing/part-d';
import {
  ANON_KEY,
  SERVICE_ROLE_KEY,
  SUPABASE_URL,
  type SeededTeam,
  mintPat,
  rest,
  seedTeam,
} from './helpers/mcp-seed';

/**
 * FILM-2007's two tools through the SDK client against a running dev
 * server (its /api/mcp), a local Supabase and the local vendor sandbox:
 *
 * 1. regenerate_shots in external mode opens a run whose briefs list only
 *    the given shots; the shots are queued with their video cleared, so
 *    the package etag changes; finalize writes the new plan in place and
 *    moves episodes.version, so it changes again. Media are mocked: the
 *    rows name objects that were never uploaded.
 * 2. localize_episode queues a translation run and a dub-episode job per
 *    language; the server's own LLM and voice workers (polling the queues
 *    the server is configured with) translate through the sandbox's
 *    Gemini, voice every line through the sandbox's ElevenLabs, write
 *    dubbed_versions and dubbed_dialogue_lines, and move the version.
 *
 *   MCP_CONTRACT_SEED=1 E2E_SUPABASE_URL=http://127.0.0.1:55421 \
 *   STUDIO_JOBS_MCP_URL=http://localhost:3308/api/mcp \
 *   STUDIO_JOBS_ELEVENLABS=http://127.0.0.1:4513 \
 *   ENCRYPTION_KEY=<the server's> \
 *     pnpm --filter @kit/studio-mcp exec vitest run studio-jobs.contract
 *
 * Skipped without MCP_CONTRACT_SEED and STUDIO_JOBS_MCP_URL: the chain needs
 * the server's workers.
 */
const SEED = process.env.MCP_CONTRACT_SEED === '1';
const SERVER = process.env.STUDIO_JOBS_MCP_URL;
const ELEVENLABS =
  process.env.STUDIO_JOBS_ELEVENLABS ?? 'http://127.0.0.1:4513';
const DUB_TIMEOUT_MS = Number(
  process.env.STUDIO_JOBS_DUB_TIMEOUT_MS ?? 420_000,
);

type Row = Record<string, unknown>;
type ToolResult = {
  isError?: boolean;
  structuredContent?: Row;
  content?: Array<{ type: string; text?: string }>;
};

const admin = (path: string) =>
  rest(path, { method: 'GET', token: SERVICE_ROLE_KEY }) as Promise<Row[]>;

/** The app's AES-GCM layout: a 12-byte IV, then the sealed text. */
async function encrypt(plain: string) {
  const raw = Buffer.from(process.env.ENCRYPTION_KEY ?? '', 'base64');
  const key = await webcrypto.subtle.importKey(
    'raw',
    raw,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const sealed = await webcrypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    new TextEncoder().encode(plain),
  );

  return Buffer.concat([iv, Buffer.from(sealed)]).toString('base64');
}

async function until<T>(read: () => Promise<T | null>, ms: number): Promise<T> {
  const deadline = Date.now() + ms;

  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

describe.skipIf(!SEED || !SERVER)(
  'regenerate_shots and localize_episode, through the SDK client',
  () => {
    let team: SeededTeam;
    let client: Client;
    let seed: ReturnType<typeof seedFixture>;
    let userClient: ReturnType<typeof createClient>;
    const log: string[] = [];

    const call = async (name: string, args: Row) => {
      const result = (await client.callTool({
        name,
        arguments: args,
      })) as ToolResult;
      log.push(
        `${name} → ${result.isError ? `ERROR ${JSON.stringify(result.structuredContent)}` : (result.content?.[0]?.text ?? '')}`,
      );
      return result;
    };
    const etag = async () =>
      (await currentEditPackageEtag(userClient as never, {
        accountId: team.accountId,
        episodeId: team.episodeId,
      }))!;
    const toolEtag = async () =>
      (await call('get_edit_package', { episodeId: team.episodeId }))
        .structuredContent!.etag as string;

    beforeAll(async () => {
      team = await seedTeam(`film-2007-${randomUUID().slice(0, 8)}`);
      seed = seedFixture(FIXTURES[0], {
        accountId: team.accountId,
        projectId: team.projectId,
        episodeId: team.episodeId,
        publicPrefix: `${SUPABASE_URL}/storage/v1/object/public`,
      });

      const { sources } = seed;
      const asAdmin = { token: SERVICE_ROLE_KEY };
      const insert = (table: string, rows: object[]) =>
        rows.length
          ? rest(`/rest/v1/${table}`, { ...asAdmin, body: rows })
          : null;
      const withEpisode = <T extends object>(rows: T[]) =>
        rows.map((row) => ({ ...row, episode_id: team.episodeId }));

      const { voices } = (await (
        await fetch(`${ELEVENLABS}/v1/voices`, {
          headers: { 'xi-api-key': 'sandbox' },
        })
      ).json()) as { voices: Array<{ voice_id: string }> };

      await rest(`/rest/v1/projects?id=eq.${team.projectId}`, {
        ...asAdmin,
        method: 'PATCH',
        body: {
          audio_settings: {
            elevenlabs: { tts_model: 'eleven_multilingual_v2' },
          },
        },
      });
      await rest(`/rest/v1/episodes?id=eq.${team.episodeId}`, {
        ...asAdmin,
        method: 'PATCH',
        body: {
          screenplay_data: sources.episode.screenplay_data,
          metadata: sources.episode.metadata,
          status: 'editing',
        },
      });
      await insert(
        'assets',
        sources.characters.map((character) => ({
          ...character,
          project_id: team.projectId,
          type: 'character',
        })),
      );
      await insert(
        'character_details',
        sources.characterDetails.map((detail, index) => ({
          ...detail,
          elevenlabs_voice_id: voices[index % voices.length]!.voice_id,
        })),
      );
      await insert('shots', withEpisode(sources.shots));
      await insert('dialogue_lines', withEpisode(sources.dialogueLines));
      await insert('external_api_keys', [
        {
          account_id: team.accountId,
          provider: 'elevenlabs',
          encrypted_key: await encrypt('sandbox-elevenlabs-key'),
          is_active: true,
        },
      ]);

      userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${team.token}` } },
        auth: { persistSession: false },
      });

      const token = await mintPat(team, [
        'studio:read',
        'studio:write',
        'studio:render',
      ]);
      client = new Client({ name: 'StorybookStudio', version: '0' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(SERVER!), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }),
      );
    }, 180_000);

    afterAll(async () => {
      console.log(`[film-2007 contract]\n${log.join('\n')}`);
      await client?.close();
    });

    it('regenerate_shots: refusals, an external run on only the given shots, and two etag changes', async () => {
      const shots = seed.sources.shots;
      const [a, b, c] = [shots[1]!, shots[3]!, shots[0]!];

      const tooMany = await call('regenerate_shots', {
        episodeId: team.episodeId,
        shotIds: Array.from({ length: 21 }, () => randomUUID()),
        reason: 'all of them',
      });
      expect(tooMany.structuredContent).toMatchObject({
        code: 'VALIDATION_FAILED',
      });

      await rest(`/rest/v1/shots?id=eq.${c.id}`, {
        token: SERVICE_ROLE_KEY,
        method: 'PATCH',
        body: { status: 'generating' },
      });
      const busy = await call('regenerate_shots', {
        episodeId: team.episodeId,
        shotIds: [c.id, a.id],
        reason: 'too dark',
      });
      expect(busy.structuredContent).toMatchObject({ code: 'RUN_IN_PROGRESS' });

      const etag0 = await etag();
      expect(await toolEtag()).toBe(etag0);

      const started = await call('regenerate_shots', {
        episodeId: team.episodeId,
        shotIds: [b.id, a.id],
        reason: 'Shot reads as daytime; it is night in the lab',
      });
      const out = started.structuredContent as {
        runId: string;
        mode: string;
        run: { parts: Array<{ partKey: string }> };
        brief: { part: { key: string }; context: Row; constraints: Row };
      };

      expect(started.isError).toBeFalsy();
      expect(out.mode).toBe('external');
      expect(out.run.parts.map((p) => p.partKey)).toEqual([
        `shot:${a.id}`,
        `shot:${b.id}`,
      ]);
      expect(out.brief.part.key).toBe(`shot:${a.id}`);
      expect(out.brief.context.scenes).toHaveLength(1);

      const queued = await admin(
        `/rest/v1/shots?id=in.(${a.id},${b.id})&select=id,status,video_url,generation_metadata`,
      );
      for (const row of queued) {
        expect(row).toMatchObject({ status: 'queued', video_url: null });
        expect((row.generation_metadata as Row).regeneration).toMatchObject({
          runId: out.runId,
        });
      }

      const etag1 = await etag();
      expect(etag1).not.toBe(etag0);
      // The version itself moves at finalize; the rows changed already
      expect(etag1.split('-')[0]).toBe(etag0.split('-')[0]);

      const shotOutput = (brief: { constraints: Row }, shotId: string) => {
        const constraints = brief.constraints as {
          characters: string[];
          locations: string[];
          shotDuration: { min: number; max: number };
        };
        const base = shotsOutput.scenes[0]!.shots[0]!;

        return {
          ...base,
          kind: 'shot',
          shotId,
          characters: constraints.characters.slice(0, 1),
          duration: constraints.shotDuration.min,
          metadata: { ...base.metadata, location: constraints.locations[0] },
          veoPrompt: {
            ...base.veoPrompt,
            fullPrompt: `Re-planned at night: ${shotId}`,
          },
        };
      };

      const first = await call('submit_generation', {
        runId: out.runId,
        partKey: `shot:${a.id}`,
        output: shotOutput(out.brief, a.id),
        model: 'claude-test',
      });
      expect(first.structuredContent).toMatchObject({
        status: 'accepted',
        remaining: 1,
      });
      const nextBrief = (
        first.structuredContent as { nextBrief: { constraints: Row } }
      ).nextBrief;

      const second = await call('submit_generation', {
        runId: out.runId,
        partKey: `shot:${b.id}`,
        output: shotOutput(nextBrief, b.id),
      });
      expect(second.structuredContent).toMatchObject({
        status: 'accepted',
        remaining: 0,
      });

      const finalized = await call('finalize_generation', { runId: out.runId });
      expect(finalized.structuredContent).toMatchObject({
        status: 'committed',
      });

      const replanned = await admin(
        `/rest/v1/shots?id=in.(${a.id},${b.id})&select=id,prompt,status,video_url`,
      );
      for (const row of replanned) {
        expect(row.prompt).toBe(`Re-planned at night: ${row.id}`);
        expect(row).toMatchObject({ status: 'queued', video_url: null });
      }

      const etag2 = await etag();
      expect(etag2).not.toBe(etag1);
      expect(Number(etag2.split('-')[0]!.slice(1))).toBe(
        Number(etag1.split('-')[0]!.slice(1)) + 1,
      );
      expect(await toolEtag()).toBe(etag2);

      const progress = await call('get_render_progress', {
        episodeId: team.episodeId,
      });
      expect(
        (progress.structuredContent as { regeneration: Row[] }).regeneration,
      ).toEqual([
        expect.objectContaining({
          kind: 'shot-regeneration',
          runId: out.runId,
          status: 'committed',
          shots: [
            expect.objectContaining({
              shotId: a.id,
              status: 'queued',
              hasVideo: false,
            }),
            expect.objectContaining({
              shotId: b.id,
              status: 'queued',
              hasVideo: false,
            }),
          ],
        }),
      ]);
    }, 120_000);

    it(
      'localize_episode: translation, per-line voice, dubbed rows at the source start, a new version, and the dubbed block',
      async () => {
        const refused = await call('localize_episode', {
          episodeId: team.episodeId,
          languages: ['pt-BR'],
        });
        expect(refused.structuredContent).toMatchObject({
          code: 'VALIDATION_FAILED',
        });

        const before = await etag();
        const started = await call('localize_episode', {
          episodeId: team.episodeId,
          languages: ['hi', 'es'],
        });
        const out = started.structuredContent as {
          translationRunId: string;
          jobs: Array<{
            language: string;
            dubbedVersionId: string;
            status: string;
          }>;
        };

        expect(started.isError).toBeFalsy();
        expect(out.translationRunId).toBeTruthy();
        expect(out.jobs.map((j) => [j.language, j.status])).toEqual([
          ['hi', 'translating'],
          ['es', 'translating'],
        ]);

        const again = await call('localize_episode', {
          episodeId: team.episodeId,
          languages: ['hi'],
        });
        expect(again.structuredContent).toMatchObject({
          code: 'RUN_IN_PROGRESS',
        });

        const [run] = await admin(
          `/rest/v1/generation_runs?id=eq.${out.translationRunId}&select=stage,mode,input`,
        );
        expect(run).toMatchObject({
          stage: 'dialogue_translation',
          mode: 'server',
          input: {
            payload: { targetLanguage: 'hi', additionalLanguages: ['es'] },
          },
        });

        const versions = await until(async () => {
          const rows = await admin(
            `/rest/v1/dubbed_versions?episode_id=eq.${team.episodeId}&select=id,language,status,voice_status,metadata&order=language`,
          );
          log.push(
            `dubbed: ${rows.map((r) => `${r.language} ${r.status}`).join(', ')}`,
          );
          if (rows.some((r) => r.status === 'failed')) {
            throw new Error(`a dub failed: ${JSON.stringify(rows)}`);
          }
          return rows.length === 2 && rows.every((r) => r.status === 'ready')
            ? rows
            : null;
        }, DUB_TIMEOUT_MS);

        const english = seed.sources.dialogueLines.filter(
          (l) => l.language === 'en',
        );

        for (const version of versions) {
          const lines = await admin(
            `/rest/v1/dubbed_dialogue_lines?dubbed_version_id=eq.${version.id}&select=original_dialogue_id,status,audio_url,timeline_start_seconds,duration_seconds,timing_adjustment`,
          );

          expect(lines).toHaveLength(english.length);
          for (const line of lines) {
            const source = english.find(
              (l) => l.id === line.original_dialogue_id,
            )!;
            expect(line.status).toBe('voiced');
            expect(String(line.audio_url)).toContain(
              `episodes/${team.episodeId}/dubbed/${version.language}/`,
            );
            expect(Number(line.timeline_start_seconds)).toBe(
              Number(source.timeline_start_seconds),
            );
            expect(Number(line.duration_seconds)).toBeGreaterThan(0);
          }
        }

        const after = await etag();
        expect(after).not.toBe(before);
        // each language that finishes moves the version
        expect(Number(after.split('-')[0]!.slice(1))).toBeGreaterThanOrEqual(
          Number(before.split('-')[0]!.slice(1)) + 2,
        );

        const pkg = (
          await call('get_edit_package', { episodeId: team.episodeId })
        ).structuredContent as {
          etag: string;
          dubbed: Array<{
            language: string;
            lines: Array<{ audio: { key: string | null } }>;
          }>;
        };
        log.push(
          `a dubbed line's audio in the package: ${JSON.stringify(pkg.dubbed[0]!.lines[0]!.audio)}`,
        );
        expect(pkg.etag).toBe(after);
        expect(pkg.dubbed.map((d) => [d.language, d.lines.length])).toEqual([
          ['es', english.length],
          ['hi', english.length],
        ]);

        const progress = (
          await call('get_render_progress', { episodeId: team.episodeId })
        ).structuredContent as { localization: Row[] };
        expect(
          progress.localization.map((v) => [v.language, v.status]),
        ).toEqual([
          ['es', 'ready'],
          ['hi', 'ready'],
        ]);

        // The translation's model cost is recorded as every LLM job's is
        const usage = await admin(
          `/rest/v1/llm_usage_analytics?account_id=eq.${team.accountId}&select=id`,
        );
        log.push(`llm_usage_analytics rows for the team: ${usage.length}`);
        expect(usage.length).toBeGreaterThan(0);
      },
      DUB_TIMEOUT_MS + 60_000,
    );
  },
);
