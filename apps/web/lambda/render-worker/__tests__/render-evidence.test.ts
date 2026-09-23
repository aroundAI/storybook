/**
 * KB-32 evidence: one server render, end to end, against the real local
 * database and a real FFmpeg. Skipped unless RENDER_EVIDENCE=1, so CI (no
 * FFmpeg, no R2 stand-in) never runs it; it is evidence for the PR, like
 * the CLICKHOUSE_EVIDENCE specs.
 *
 * Real: the worker's `handler`, supabase-js against local PostgREST, the
 * edit-suite schema, `processFFmpegRender`, the FFmpeg binary.
 * Stood in: R2 (`uploadToR2` writes to a local directory), the media host
 * (`fetch` serves generated files for `*.invalid` URLs), and the DNS lookup
 * in the SSRF guard. Everything else `fetch` is asked for is refused, and
 * the pre-flight aborts before any work if the run could reach anything but
 * this machine.
 *
 *   # under the DB lock, after `supabase db reset` from this worktree
 *   npm i --prefix <dir> ffmpeg-static@5.3.0     # the version SST installs
 *   eval "$(cd apps/web && npx supabase status -o env | grep -E '^(API_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
 *   RENDER_EVIDENCE=1 FFMPEG_PATH=<dir>/node_modules/ffmpeg-static/ffmpeg \
 *   RENDER_EVIDENCE_SUPABASE_URL=$API_URL RENDER_EVIDENCE_ANON_KEY=$ANON_KEY \
 *   RENDER_EVIDENCE_SERVICE_ROLE_KEY=$SERVICE_ROLE_KEY \
 *     npx vitest run lambda/render-worker/__tests__/render-evidence.test.ts
 */
import { createClient } from '@supabase/supabase-js';

import type { SQSEvent } from 'aws-lambda';
import { execFileSync, spawnSync } from 'child_process';
import { randomUUID } from 'crypto';
import {
  accessSync,
  constants,
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Database } from '@kit/supabase/database';

const ENABLED = process.env.RENDER_EVIDENCE === '1';
const SUPABASE_URL = process.env.RENDER_EVIDENCE_SUPABASE_URL ?? '';
const ANON_KEY = process.env.RENDER_EVIDENCE_ANON_KEY ?? '';
const SERVICE_KEY = process.env.RENDER_EVIDENCE_SERVICE_ROLE_KEY ?? '';
const FFMPEG = process.env.FFMPEG_PATH ?? '';

const root = mkdtempSync(join(tmpdir(), 'kb32-evidence-'));
const mediaDir = join(root, 'media');
const uploadDir = join(root, 'r2');

vi.mock('dns/promises', () => {
  const lookup = vi.fn().mockRejectedValue(new Error('ENOTFOUND (evidence)'));
  return { lookup, default: { lookup } };
});

vi.mock('../utils/r2-storage', () => ({
  uploadToR2: vi.fn(
    async (bucket: string, path: string, data: Buffer | Readable) => {
      const file = join(uploadDir, bucket, path);
      mkdirSync(join(file, '..'), { recursive: true });
      if (Buffer.isBuffer(data)) writeFileSync(file, data);
      else await pipeline(data, createWriteStream(file));
      return { url: `https://r2.kb32.invalid/${bucket}/${path}`, path };
    },
  ),
}));

const refused: string[] = [];

/** Pre-flight: every way this run could leave the machine, checked first. */
function preflight() {
  const problems: string[] = [];
  const host = SUPABASE_URL ? new URL(SUPABASE_URL).hostname : '';

  if (!['127.0.0.1', 'localhost'].includes(host))
    problems.push(
      `RENDER_EVIDENCE_SUPABASE_URL is not local: "${SUPABASE_URL}"`,
    );
  if (!ANON_KEY || !SERVICE_KEY) problems.push('local Supabase keys missing');

  for (const name of [
    'R2_ACCOUNT_ID',
    'R2_ACCESS_KEY_ID',
    'R2_SECRET_ACCESS_KEY',
    'R2_BUCKET_NAME',
    'R2_PUBLIC_URL',
    'AWS_LAMBDA_FUNCTION_NAME',
  ]) {
    if (process.env[name]) problems.push(`${name} is set`);
  }

  // the worker skips the WebSocket push only when these are empty
  if (process.env.CONNECTIONS_TABLE_NAME || process.env.WEBSOCKET_ENDPOINT)
    problems.push('WebSocket configuration is set');

  try {
    accessSync(FFMPEG, constants.X_OK);
  } catch {
    problems.push(`FFMPEG_PATH is not an executable: "${FFMPEG}"`);
  }

  if (problems.length) {
    throw new Error(
      `render evidence pre-flight refused:\n- ${problems.join('\n- ')}`,
    );
  }
}

function ffmpeg(args: string[]) {
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...args]);
}

/** What `ffmpeg -i` says about a file (it exits 1 without an output; fine). */
function probe(file: string) {
  const { stderr } = spawnSync(FFMPEG, ['-hide_banner', '-i', file], {
    encoding: 'utf8',
  });
  const duration = /Duration: (\d+):(\d+):([\d.]+)/.exec(stderr);
  const video =
    /Stream .*Video: (\w+).*?, (\w+)(?:\([^)]*\))?, (\d+)x(\d+).*?, ([\d.]+) fps/.exec(
      stderr,
    );
  const audio = /Stream .*Audio: (\w+)/.exec(stderr);

  return {
    durationS: duration
      ? Number(duration[1]) * 3600 +
        Number(duration[2]) * 60 +
        Number(duration[3])
      : null,
    videoCodec: video?.[1] ?? null,
    pixFmt: video?.[2] ?? null,
    width: video ? Number(video[3]) : null,
    height: video ? Number(video[4]) : null,
    fps: video ? Number(video[5]) : null,
    audioCodec: audio?.[1] ?? null,
  };
}

const service = createClient<Database>(
  SUPABASE_URL || 'http://127.0.0.1:1',
  SERVICE_KEY || 'x',
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);

const ids = {
  user: '',
  project: '',
  episode: randomUUID(),
  editProject: randomUUID(),
  videoTrack: randomUUID(),
  dialogueTrack: randomUUID(),
};

const results: Record<
  string,
  ReturnType<typeof probe> & { url: string | null }
> = {};

describe.skipIf(!ENABLED)(
  'KB-32 render evidence (local DB + real FFmpeg)',
  () => {
    let handler: (
      event: SQSEvent,
    ) => Promise<{ batchItemFailures: { itemIdentifier: string }[] }>;

    beforeAll(async () => {
      vi.stubEnv('CONNECTIONS_TABLE_NAME', '');
      vi.stubEnv('WEBSOCKET_ENDPOINT', '');
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('VENDOR_SANDBOX', '1');
      vi.stubEnv('AWS_EC2_METADATA_DISABLED', 'true');
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL);
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY);
      preflight();

      const realFetch = globalThis.fetch;
      const supabaseOrigin = new URL(SUPABASE_URL).origin;

      vi.stubGlobal(
        'fetch',
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(
            input instanceof Request ? input.url : String(input),
          );

          if (url.origin === supabaseOrigin) return realFetch(input, init);

          if (url.hostname === 'media.kb32.invalid') {
            return new Response(
              readFileSync(join(mediaDir, url.pathname.slice(1))),
            );
          }

          refused.push(url.href);
          throw new Error(`evidence sandbox refused ${url.href}`);
        },
      );

      // 3 s sources. Video from testsrc is RGB, which libx264 encodes 4:4:4
      // unless told otherwise, so the output's pixel format is a real test.
      mkdirSync(mediaDir, { recursive: true });
      mkdirSync(uploadDir, { recursive: true });
      for (const name of ['v1', 'v2']) {
        ffmpeg([
          '-f',
          'lavfi',
          '-i',
          'testsrc=size=640x360:rate=30:duration=3',
          '-c:v',
          'libx264',
          '-y',
          join(mediaDir, `${name}.mp4`),
        ]);
      }
      ffmpeg([
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:duration=3',
        '-y',
        join(mediaDir, 'en.m4a'),
      ]);
      ffmpeg([
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=880:duration=3',
        '-y',
        join(mediaDir, 'es.m4a'),
      ]);

      // A project is created by its owner, as in the product: the insert
      // trigger makes `created_by` the project's owner member.
      const email = `kb32-evidence-${randomUUID()}@makerkit.dev`;
      const password = `pw-${randomUUID()}`;
      const { data: created, error: userError } =
        await service.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
        });
      if (userError || !created.user) throw userError ?? new Error('no user');
      ids.user = created.user.id;

      const owner = createClient<Database>(SUPABASE_URL, ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: signInError } = await owner.auth.signInWithPassword({
        email,
        password,
      });
      if (signInError) throw signInError;

      const { data: project, error: projectError } = await owner
        .from('projects')
        .insert({
          account_id: ids.user,
          name: 'KB-32 evidence',
          slug: `kb32-${ids.episode.slice(0, 8)}`,
        })
        .select('id')
        .single();
      if (projectError) throw projectError;
      ids.project = project.id;

      const insert = async (
        table: 'episodes' | 'edit_projects' | 'edit_tracks' | 'edit_clips',
        rows: object[],
      ) => {
        const { error } = await service.from(table).insert(rows as never);
        if (error) throw new Error(`${table}: ${error.message}`);
      };

      await insert('episodes', [
        {
          id: ids.episode,
          project_id: ids.project,
          number: 1,
          title: 'KB-32 evidence',
        },
      ]);
      await insert('edit_projects', [
        {
          id: ids.editProject,
          episode_id: ids.episode,
          width: 1280,
          height: 720,
          fps: 30,
        },
      ]);
      await insert('edit_tracks', [
        {
          id: ids.videoTrack,
          edit_project_id: ids.editProject,
          type: 'video',
          name: 'Video',
          sort_order: 0,
        },
        {
          id: ids.dialogueTrack,
          edit_project_id: ids.editProject,
          type: 'dialogue',
          name: 'Dialogue',
          sort_order: 1,
        },
      ]);
      // the fixture of the EDD §3: two contiguous shots; an EN line, active,
      // and its ES dub, inactive as auto-assemble writes a non-preview language
      const media = (file: string) => `https://media.kb32.invalid/${file}`;
      await insert('edit_clips', [
        {
          track_id: ids.videoTrack,
          media_url: media('v1.mp4'),
          start_ms: 0,
          end_ms: 2000,
          in_point_ms: 0,
          out_point_ms: 2000,
        },
        {
          track_id: ids.videoTrack,
          media_url: media('v2.mp4'),
          start_ms: 2000,
          end_ms: 3000,
          in_point_ms: 1000,
          out_point_ms: 2000,
        },
        {
          track_id: ids.dialogueTrack,
          media_url: media('en.m4a'),
          start_ms: 500,
          end_ms: 2500,
          in_point_ms: 0,
          out_point_ms: 2000,
          language: 'en',
          is_active: true,
        },
        {
          track_id: ids.dialogueTrack,
          media_url: media('es.m4a'),
          start_ms: 500,
          end_ms: 2500,
          in_point_ms: 0,
          out_point_ms: 2000,
          language: 'es',
          is_active: false,
        },
      ]);

      ({ handler } = await import('../index'));
    }, 120_000);

    afterAll(async () => {
      if (ids.project)
        await service.from('projects').delete().eq('id', ids.project);
      if (ids.user) await service.auth.admin.deleteUser(ids.user);

      if (process.env.EVIDENCE_DIR) {
        mkdirSync(process.env.EVIDENCE_DIR, { recursive: true });
        writeFileSync(
          join(process.env.EVIDENCE_DIR, 'kb32-render-evidence.json'),
          JSON.stringify({ ffmpeg: FFMPEG, results, refused }, null, 2),
        );
      }

      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      rmSync(root, { recursive: true, force: true });
    });

    async function render(language: string) {
      const event = {
        Records: [
          {
            messageId: `kb32-${language}`,
            body: JSON.stringify({
              editProjectId: ids.editProject,
              userId: ids.user,
              language,
            }),
          },
        ],
      } as unknown as SQSEvent;

      const response = await handler(event);
      const { data: row } = await service
        .from('edit_projects')
        .select('render_status, render_url, render_error')
        .eq('id', ids.editProject)
        .single();

      return { response, row };
    }

    it('renders the English export: completed, uploaded, 1280x720 yuv420p, 3.0 s, with audio', async () => {
      const { response, row } = await render('en');

      expect(row?.render_error).toBeNull();
      expect(response.batchItemFailures).toEqual([]);
      expect(row?.render_status).toBe('completed');
      expect(row?.render_url).toBe(
        `https://r2.kb32.invalid/renders/${ids.editProject}/en/output.mp4`,
      );

      const out = probe(
        join(uploadDir, 'renders', ids.editProject, 'en', 'output.mp4'),
      );
      results.en = { ...out, url: row?.render_url ?? null };

      expect(out).toMatchObject({
        videoCodec: 'h264',
        pixFmt: 'yuv420p',
        width: 1280,
        height: 720,
        fps: 30,
        audioCodec: 'aac',
      });
      expect(out.durationS).toBeGreaterThan(2.9);
      expect(out.durationS).toBeLessThan(3.1);

      const { data: episode } = await service
        .from('episodes')
        .select('master_video_asset_id')
        .eq('id', ids.episode)
        .single();
      const { data: asset } = await service
        .from('assets')
        .select('type, file_url')
        .eq('id', episode?.master_video_asset_id ?? '')
        .single();

      expect(asset).toEqual({
        type: 'master_video',
        file_url: row?.render_url,
      });
    }, 120_000);

    it('renders the Spanish export with the Spanish dub, though the preview shows English', async () => {
      const { response, row } = await render('es');

      expect(row?.render_error).toBeNull();
      expect(response.batchItemFailures).toEqual([]);
      expect(row?.render_status).toBe('completed');

      const out = probe(
        join(uploadDir, 'renders', ids.editProject, 'es', 'output.mp4'),
      );
      results.es = { ...out, url: row?.render_url ?? null };

      // the dub is the only audio clip in an ES render: no dub, no audio stream
      expect(out.audioCodec).toBe('aac');
      expect(out).toMatchObject({
        videoCodec: 'h264',
        pixFmt: 'yuv420p',
        width: 1280,
        height: 720,
      });
    }, 120_000);

    it('sent nothing anywhere but local Supabase and the stand-ins', () => {
      expect(refused).toEqual([]);
    });
  },
);
