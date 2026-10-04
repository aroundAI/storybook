import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  EditPackageSchema,
  EditPackageUnchangedSchema,
} from '@kit/desktop-integration';
import {
  FIXTURES,
  RETENTION_CURVE,
  seedFixture,
} from '@kit/desktop-integration/fixtures';
import { collectMediaUrls } from '@kit/desktop-integration/server';

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
 * FILM-2001's get_edit_package through the SDK client, against a local
 * Supabase and its Storage. The route handlers run in process. The 60-shot
 * two-language fixture seed (the one the committed fixtures are built from)
 * is written into a fresh team, its media uploaded, and the tool called
 * with personal access tokens of three kinds.
 *
 *   MCP_CONTRACT_SEED=1 E2E_SUPABASE_URL=http://127.0.0.1:55421 \
 *     pnpm --filter @kit/studio-mcp exec vitest run edit-package.contract
 *
 * With EDIT_PACKAGE_CLICKHOUSE=<url> (and CLICKHOUSE_PASSWORD) it also
 * publishes the episode, writes a retention curve into that ClickHouse and
 * checks the hints against the hand-computed answer; without it the hints
 * must say `unmeasured`. Skipped without MCP_CONTRACT_SEED.
 *
 * With EDIT_PACKAGE_MCP_URL=http://localhost:3303/api/mcp the calls go to a
 * running dev server instead of the in-process handlers, and
 * EDIT_PACKAGE_SERVER_LOG names that server's log file, which the
 * no-signed-URL check reads too. The server must have ClickHouse on or off
 * as EDIT_PACKAGE_CLICKHOUSE says.
 */
const SEED = process.env.MCP_CONTRACT_SEED === '1';
const CLICKHOUSE = process.env.EDIT_PACKAGE_CLICKHOUSE;
const SERVER = process.env.EDIT_PACKAGE_MCP_URL;
const SERVER_LOG = process.env.EDIT_PACKAGE_SERVER_LOG;

type CallResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
  content?: Array<{ type: string; text?: string }>;
};

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  png: 'image/png',
  mp3: 'audio/mpeg',
};

async function clickhouse(sql: string, body?: string) {
  const url = new URL(CLICKHOUSE!);
  url.searchParams.set('query', sql);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'X-ClickHouse-User': process.env.CLICKHOUSE_USER ?? 'default',
      'X-ClickHouse-Key': process.env.CLICKHOUSE_PASSWORD ?? '',
    },
    body,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`ClickHouse ${response.status}: ${text}`);
  return text;
}

describe.skipIf(!SEED)(
  'get_edit_package, through the SDK client, over a seeded 60-shot episode',
  () => {
    const url = new URL(SERVER ?? 'http://localhost:3303/api/mcp');
    const stamp = randomUUID().slice(0, 8);
    const output: string[] = [];
    let team: SeededTeam;
    let outsider: SeededTeam;
    let http: typeof fetch;
    let reader: Client;
    let renderOnly: Client;
    let stranger: Client;
    let seed: ReturnType<typeof seedFixture>;
    let publishId: string | null = null;
    const restoreWrites: Array<() => void> = [];

    beforeAll(async () => {
      Object.assign(process.env, {
        NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
        SUPABASE_JWT_SECRET: JWT_SECRET,
        CACHE_PROVIDER: 'memory',
        NEXT_PUBLIC_SITE_URL: url.origin,
        STORAGE_PROVIDER: 'supabase',
      });

      if (CLICKHOUSE) {
        Object.assign(process.env, {
          CLICKHOUSE_ENABLED: 'true',
          CLICKHOUSE_HOST: CLICKHOUSE,
        });
      } else {
        delete process.env.CLICKHOUSE_ENABLED;
      }

      if (SERVER) {
        http = fetch;
      } else {
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

      team = await seedTeam(`edit-package-${stamp}`);
      outsider = await seedTeam(`outsider-${stamp}`);
      seed = seedFixture(FIXTURES[2], {
        accountId: team.accountId,
        projectId: team.projectId,
        episodeId: team.episodeId,
        publicPrefix: `${SUPABASE_URL}/storage/v1/object/public`,
      });

      const { sources } = seed;
      const admin = { token: SERVICE_ROLE_KEY };
      const insert = (table: string, rows: object[]) =>
        rows.length
          ? rest(`/rest/v1/${table}`, { ...admin, body: rows })
          : null;
      const withEpisode = <T extends object>(rows: T[]) =>
        rows.map((row) => ({ ...row, episode_id: team.episodeId }));

      await rest(`/rest/v1/projects?id=eq.${team.projectId}`, {
        token: team.token,
        method: 'PATCH',
        body: {
          brand: sources.project.brand,
          edit_policy: sources.project.edit_policy,
        },
      });
      await rest(`/rest/v1/episodes?id=eq.${team.episodeId}`, {
        ...admin,
        method: 'PATCH',
        body: {
          screenplay_data: sources.episode.screenplay_data,
          metadata: sources.episode.metadata,
          target_duration_seconds: sources.episode.target_duration_seconds,
          status: 'storyboard',
        },
      });
      await insert(
        'assets',
        sources.characters.map((character) => ({
          ...character,
          project_id: team.projectId,
          type: 'character',
          file_hash: sources.recordedHashes[character.file_url ?? ''] ?? null,
        })),
      );
      await insert('character_details', sources.characterDetails);
      await insert('shots', withEpisode(sources.shots));
      await insert('dialogue_lines', withEpisode(sources.dialogueLines));
      await insert(
        'audio_assets',
        sources.audioAssets.map((asset) => ({
          ...asset,
          project_id: team.projectId,
          audio_type: 'music',
          prompt: 'A tense electronic bed.',
          prompt_hash: `film-2001-${stamp}`,
          source: 'generated',
          status: 'completed',
        })),
      );
      await insert('audio_tracks', withEpisode(sources.audioTracks));
      await insert('captions', withEpisode(sources.captions));
      await insert('caption_segments', sources.captionSegments);
      // shorts.duration_seconds is generated from start and end.
      await insert(
        'shorts',
        withEpisode(
          sources.shorts.map(
            ({ duration_seconds: _generated, ...short }) => short,
          ),
        ),
      );
      await insert('dubbed_versions', withEpisode(sources.dubbedVersions));
      await insert('dubbed_dialogue_lines', sources.dubbedLines);

      // Every object the rows name, except the ones the seed leaves missing
      // on purpose and the frame that points into another project.
      const prefix = `${SUPABASE_URL}/storage/v1/object/public/`;
      const uploads = collectMediaUrls(sources)
        .map((media) => media.slice(prefix.length))
        .filter(
          (key) =>
            !seed.missingKeys.has(key) &&
            key.includes(team.projectId) !== key.includes(team.episodeId) &&
            (key.includes(team.projectId) || key.includes(team.episodeId)),
        );

      for (let index = 0; index < uploads.length; index += 16) {
        await Promise.all(
          uploads.slice(index, index + 16).map(async (key) => {
            const [bucket, ...path] = key.split('/');
            const response = await fetch(
              `${SUPABASE_URL}/storage/v1/object/${bucket}/${path.join('/')}`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
                  'Content-Type': MIME[key.split('.').pop()!]!,
                  'x-upsert': 'true',
                },
                body: Buffer.from(`film-2001 ${key}`),
              },
            );
            if (!response.ok) {
              throw new Error(`upload ${key}: ${await response.text()}`);
            }
          }),
        );
      }

      if (CLICKHOUSE) {
        const [publish] = await rest('/rest/v1/publishes', {
          ...admin,
          prefer: 'return=representation',
          body: {
            episode_id: team.episodeId,
            platform: 'youtube',
            status: 'published',
            published_at: '2026-10-01T09:00:00Z',
            duration_seconds: 300,
          },
        });
        publishId = publish.id as string;
        await clickhouse(
          'INSERT INTO video_retention_curves (project_id, video_id, platform, elapsed_ratio, audience_watch_ratio, fetched_at) FORMAT JSONEachRow',
          RETENTION_CURVE.map((point) =>
            JSON.stringify({
              project_id: team.projectId,
              video_id: publishId,
              platform: 'youtube',
              elapsed_ratio: point.elapsedRatio,
              audience_watch_ratio: point.audienceWatchRatio,
              fetched_at: '2026-10-03 06:00:00',
            }),
          ).join('\n'),
        );
      }

      const connect = async (token: string) => {
        const c = new Client({ name: 'edit-package-contract', version: '0' });
        await c.connect(
          new StreamableHTTPClientTransport(url, {
            requestInit: { headers: { Authorization: `Bearer ${token}` } },
            fetch: http,
          }),
        );
        return c;
      };

      reader = await connect(await mintPat(team, ['studio:read']));
      renderOnly = await connect(await mintPat(team, ['studio:render']));
      stranger = await connect(await mintPat(outsider, ['studio:read']));

      // Everything written to stdout, stderr or the console from here on.
      for (const stream of [process.stdout, process.stderr]) {
        const write = stream.write.bind(stream);
        stream.write = ((chunk: unknown, ...rest: unknown[]) => {
          output.push(String(chunk));
          return (write as (...a: unknown[]) => boolean)(chunk, ...rest);
        }) as typeof stream.write;
        restoreWrites.push(() => {
          stream.write = write;
        });
      }
      for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
        const original = console[level];
        console[level] = (...args: unknown[]) => {
          output.push(
            args.map((a) => JSON.stringify(a) ?? String(a)).join(' '),
          );
          original(...args);
        };
        restoreWrites.push(() => {
          console[level] = original;
        });
      }
    }, 180_000);

    afterAll(async () => {
      for (const restore of restoreWrites) restore();
      await reader?.close();
      await renderOnly?.close();
      await stranger?.close();
      if (CLICKHOUSE && publishId) {
        await clickhouse(
          `ALTER TABLE video_retention_curves DELETE WHERE video_id = '${publishId}'`,
        ).catch(() => undefined);
      }
    });

    const call = (c: Client, args: Record<string, unknown>) =>
      c.callTool({
        name: 'get_edit_package',
        arguments: args,
      }) as Promise<CallResult>;

    it('returns a schema-valid 60-shot two-language package under 1 MB, in under 2 s', async () => {
      const timings: number[] = [];
      let result: CallResult | null = null;

      for (let run = 0; run < 3; run++) {
        const started = performance.now();
        result = await call(reader, { episodeId: team.episodeId });
        timings.push(Math.round(performance.now() - started));
      }

      expect(
        result!.isError,
        JSON.stringify(result!.structuredContent),
      ).toBeFalsy();
      const editPackage = EditPackageSchema.parse(result!.structuredContent);
      const bytes = Buffer.byteLength(JSON.stringify(editPackage));

      console.info('[FILM-2001 measurement]', {
        callMs: timings,
        packageBytes: bytes,
        shots: editPackage.shots.length,
        dialogue: editPackage.dialogue.length,
        captionSegments: editPackage.captions.reduce(
          (sum, c) => sum + c.segments.length,
          0,
        ),
      });

      expect(editPackage.shots).toHaveLength(60);
      expect(editPackage.episode.languages).toEqual(['en', 'hi']);
      expect(editPackage.dubbed[0]!.lines).toHaveLength(120);
      expect(editPackage.captions.map((c) => c.segments.length)).toEqual([
        120, 120,
      ]);
      expect(bytes).toBeLessThan(1024 * 1024);
      expect(Math.min(...timings)).toBeLessThan(2000);
      expect(editPackage.brand.colors.primary).toBe('#0EA5E9');
      expect(editPackage.editPolicy.maxShotLength).toBe(5);
    }, 30_000);

    it('signs URLs a plain GET fetches, and gives a reason where it cannot', async () => {
      const result = await call(reader, { episodeId: team.episodeId });
      const editPackage = EditPackageSchema.parse(result.structuredContent);
      const video = editPackage.shots[0]!.video;

      if (video.url === null) throw new Error(`no video: ${video.mediaReason}`);

      expect(video.url).toContain('/storage/v1/object/sign/');
      const response = await fetch(video.url);
      const body = Buffer.from(await response.arrayBuffer());
      expect(response.status).toBe(200);
      expect(body.toString()).toBe(`film-2001 ${video.key}`);
      expect(video.bytes).toBe(body.byteLength);
      expect(video.mime).toBe('video/mp4');

      expect(editPackage.shots.at(-1)!.video).toEqual({
        url: null,
        mediaReason: 'not_generated',
      });
      expect(editPackage.shots[1]!.firstFrame).toEqual({
        url: null,
        mediaReason: 'outside_project',
      });
      expect(editPackage.dialogue[2]!.audio).toEqual({
        url: null,
        mediaReason: 'missing',
      });

      const maya = editPackage.characters.find((c) => c.name === 'MAYA')!;
      const image = maya.referenceImages[0]!;
      expect(image.url !== null && image.sha256).toBe(
        Object.values(seed.sources.recordedHashes)[0],
      );
    });

    it(
      CLICKHOUSE
        ? 'carries the hand-computed retention drops from ClickHouse'
        : 'says retention is unmeasured with ClickHouse off',
      async () => {
        const result = await call(reader, { episodeId: team.episodeId });
        const hints = EditPackageSchema.parse(
          result.structuredContent,
        ).analyticsHints;

        if (!CLICKHOUSE) {
          expect(hints).toEqual({
            retention: [],
            publishId: null,
            reason: 'unmeasured',
          });
          return;
        }

        // 1.5 points lost every 5%, plus 12 at 0-5%, 8 at 30-35%, 10 at
        // 70-75%; the published video is 300 s.
        expect(hints).toEqual({
          publishId,
          retention: [
            [0, 0, 13.5],
            [90, 0.3, 9.5],
            [210, 0.7, 11.5],
          ].map(([timestamp, elapsedRatio, dropPercentage]) => ({
            timestamp,
            elapsedRatio,
            dropPercentage,
            platform: 'youtube',
            asOf: '2026-10-03T06:00:00Z',
          })),
        });
      },
    );

    it('answers unchanged for the current etag, and a new etag after a shot or the brand changes', async () => {
      const first = EditPackageSchema.parse(
        (await call(reader, { episodeId: team.episodeId })).structuredContent,
      );

      const same = await call(reader, {
        episodeId: team.episodeId,
        ifNoneMatch: first.etag,
      });
      expect(EditPackageUnchangedSchema.parse(same.structuredContent)).toEqual({
        unchanged: true,
        etag: first.etag,
      });

      const shot = seed.sources.shots[0]!;
      await rest(`/rest/v1/shots?id=eq.${shot.id}`, {
        token: team.token,
        method: 'PATCH',
        body: { video_url: `${shot.video_url}?v=2` },
      });
      const afterShot = await call(reader, {
        episodeId: team.episodeId,
        ifNoneMatch: first.etag,
      });
      const shotEtag = String(afterShot.structuredContent!.etag);
      expect(afterShot.structuredContent!.unchanged).toBeUndefined();
      expect(shotEtag).not.toBe(first.etag);

      await rest(`/rest/v1/projects?id=eq.${team.projectId}`, {
        token: team.token,
        method: 'PATCH',
        body: { brand: { colors: { primary: '#111111' } } },
      });
      const afterBrand = await call(reader, {
        episodeId: team.episodeId,
        ifNoneMatch: shotEtag,
      });
      expect(afterBrand.structuredContent!.unchanged).toBeUndefined();
      expect(afterBrand.structuredContent!.etag).not.toBe(shotEtag);
    }, 30_000);

    it('refuses a token without studio:read as FORBIDDEN', async () => {
      const result = await call(renderOnly, { episodeId: team.episodeId });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        code: 'FORBIDDEN',
        details: { required_scope: 'studio:read' },
      });
    });

    it('answers another team’s episode as NOT_FOUND', async () => {
      const result = await call(stranger, { episodeId: team.episodeId });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({ code: 'NOT_FOUND' });
    });

    it('records each call in mcp_tool_calls and never writes a signed URL to the row or the log', async () => {
      const rows = (await rest(
        `/rest/v1/mcp_tool_calls?tool=eq.get_edit_package&account_id=in.(${team.accountId},${outsider.accountId})&order=created_at`,
        { token: SERVICE_ROLE_KEY, method: 'GET' },
      )) as Array<Record<string, unknown>>;

      expect(rows.length).toBeGreaterThanOrEqual(10);
      expect(new Set(rows.map((r) => r.status))).toEqual(
        new Set(['ok', 'error']),
      );
      expect(
        rows
          .filter((r) => r.status === 'error')
          .map((r) => r.error_code)
          .sort(),
      ).toEqual(['FORBIDDEN', 'NOT_FOUND']);

      const serverLog = SERVER_LOG ? readFileSync(SERVER_LOG, 'utf8') : '';
      if (SERVER_LOG) expect(serverLog).toContain('/api/mcp');
      const written = `${JSON.stringify(rows)}\n${output.join('\n')}\n${serverLog}`;
      // The positive control: the capture did see this test's own output.
      expect(written).toContain('[FILM-2001 measurement]');
      expect(written).not.toContain('/object/sign/');
      expect(written).not.toMatch(/[?&]token=ey/);
      expect(written).not.toContain('X-Amz-Signature');
    });
  },
);
