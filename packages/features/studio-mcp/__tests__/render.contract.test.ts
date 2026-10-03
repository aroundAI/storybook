import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
 * FILM-1909's render tools through the SDK client, against a local
 * Supabase and the local queue (ElasticMQ). The route handlers run in
 * process; each run gets its own two queues, so what the tools queued is
 * read back exactly, and nothing reaches another run's worker.
 *
 *   MCP_CONTRACT_SEED=1 E2E_SUPABASE_URL=http://127.0.0.1:55321 \
 *     RENDER_CONTRACT_SQS=http://127.0.0.1:4120 \
 *     pnpm --filter @kit/studio-mcp exec vitest run render.contract
 *
 * Skipped without both, so the unit run needs no database and no queue.
 */
const SEED = process.env.MCP_CONTRACT_SEED === '1';
const SQS = process.env.RENDER_CONTRACT_SQS;

type CallResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

async function sqs(action: string, params: Record<string, string>, url = SQS!) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ Action: action, ...params }).toString(),
  });
  const text = await response.text();

  if (!response.ok) throw new Error(`${action} → ${response.status}: ${text}`);

  return text;
}

const XML_ENTITIES: Record<string, string> = {
  '&quot;': '"',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&apos;': "'",
};

/** Every message on the queue, drained. */
async function drain(queueUrl: string) {
  const bodies: Array<Record<string, unknown>> = [];

  for (let round = 0; round < 10; round++) {
    const xml = await sqs(
      'ReceiveMessage',
      { MaxNumberOfMessages: '10', WaitTimeSeconds: '1' },
      queueUrl,
    );
    const found = [...xml.matchAll(/<Body>([\s\S]*?)<\/Body>/g)].map((m) =>
      JSON.parse(m[1]!.replace(/&\w+;/g, (e) => XML_ENTITIES[e] ?? e)),
    );

    if (found.length === 0) break;
    bodies.push(...found);
  }

  return bodies;
}

describe.skipIf(!SEED || !SQS)(
  'the render tools, through the SDK client, queue what the web queues',
  () => {
    const url = new URL('http://localhost:3220/api/mcp');
    const stamp = randomUUID().slice(0, 8);
    let voiceQueue = '';
    let llmQueue = '';
    let team: SeededTeam;
    let http: typeof fetch;
    let client: Client;
    let readOnly: Client;
    const lineIds: string[] = [];
    let cueId = '';

    beforeAll(async () => {
      const created = async (name: string) => {
        const xml = await sqs('CreateQueue', { QueueName: name });
        return /<QueueUrl>(.*?)<\/QueueUrl>/.exec(xml)![1]!;
      };
      voiceQueue = await created(`t1909-voice-${stamp}`);
      llmQueue = await created(`t1909-llm-${stamp}`);

      Object.assign(process.env, {
        NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
        SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
        SUPABASE_JWT_SECRET: JWT_SECRET,
        CACHE_PROVIDER: 'memory',
        NEXT_PUBLIC_SITE_URL: url.origin,
        VENDOR_SANDBOX: '1',
        VENDOR_URL_SQS: SQS,
        VOICE_QUEUE_URL: voiceQueue,
        LLM_JOBS_QUEUE_URL: llmQueue,
      });

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

      team = await seedTeam(`render-${stamp}`);
      const owner = { token: team.token };

      await rest(`/rest/v1/projects?id=eq.${team.projectId}`, {
        ...owner,
        method: 'PATCH',
        body: {
          audio_settings: {
            elevenlabs: { tts_model: 'eleven_multilingual_v2' },
          },
        },
      });

      const [ada, hall] = await rest('/rest/v1/assets', {
        ...owner,
        prefer: 'return=representation',
        body: [
          {
            project_id: team.projectId,
            type: 'character',
            name: 'Ada',
            file_url: 'https://img.test/ada.png',
          },
          {
            project_id: team.projectId,
            type: 'location',
            name: 'Hall',
            file_url: 'https://img.test/hall.png',
          },
        ],
      });
      await rest('/rest/v1/character_details', {
        ...owner,
        body: { asset_id: ada.id, elevenlabs_voice_id: 'voice-ada' },
      });
      expect(hall.id).toBeTruthy();

      const lines = await rest('/rest/v1/dialogue_lines', {
        ...owner,
        prefer: 'return=representation',
        body: [
          {
            episode_id: team.episodeId,
            sequence_number: 1,
            scene_number: 1,
            text: 'Hello.',
            character_asset_id: ada.id,
            language: 'en',
            status: 'pending',
          },
          {
            episode_id: team.episodeId,
            sequence_number: 2,
            scene_number: 1,
            text: 'Again.',
            character_asset_id: ada.id,
            language: 'en',
            status: 'pending',
          },
        ],
      });
      lineIds.push(...lines.map((line: { id: string }) => line.id));

      const [cue] = await rest('/rest/v1/audio_cues', {
        ...owner,
        prefer: 'return=representation',
        body: {
          episode_id: team.episodeId,
          scene_number: 1,
          cue_type: 'music',
          prompt: 'A slow piano under the hall.',
          start_offset_seconds: 0,
          duration_seconds: 12,
          status: 'pending',
        },
      });
      cueId = cue.id;

      await rest('/rest/v1/shots', {
        ...owner,
        body: [1, 2].map((n) => ({
          episode_id: team.episodeId,
          scene_number: 1,
          shot_number: n,
          sequence_number: n,
          duration_seconds: 5,
          scene_description: `Ada in the hall, shot ${n}.`,
          prompt: `prompt ${n}`,
          status: 'pending',
          first_frame_description: `Ada at the door (${n}).`,
          last_frame_description: `Ada at the stairs (${n}).`,
          transition_type: n === 2 ? 'continuation' : 'cut',
          generation_metadata: {
            characters: ['Ada'],
            location: 'Hall',
            veoPrompt: { fullPrompt: `VEO: Ada crosses the hall (${n}).` },
          },
        })),
      });

      const connect = async (token: string) => {
        const c = new Client({ name: 'render-contract', version: '0' });
        await c.connect(
          new StreamableHTTPClientTransport(url, {
            requestInit: { headers: { Authorization: `Bearer ${token}` } },
            fetch: http,
          }),
        );
        return c;
      };

      client = await connect(
        await mintPat(team, ['studio:read', 'studio:render']),
      );
      readOnly = await connect(await mintPat(team, ['studio:read']));
    }, 90_000);

    afterAll(async () => {
      await client?.close();
      await readOnly?.close();
      for (const queue of [voiceQueue, llmQueue].filter(Boolean)) {
        await sqs('DeleteQueue', {}, queue).catch(() => undefined);
      }
    });

    const call = (c: Client, name: string, args: Record<string, unknown>) =>
      c.callTool({ name, arguments: args }) as Promise<CallResult>;

    it('get_veo_manifest returns the VEO prompts, frame descriptions and reference images', async () => {
      const result = await call(client, 'get_veo_manifest', {
        episodeId: team.episodeId,
      });

      expect(result.isError).toBeFalsy();
      const shots = result.structuredContent!.shots as Array<
        Record<string, unknown>
      >;
      expect(
        shots.map((s) => [
          s.shot,
          s.veoPrompt,
          s.firstFrameDescription,
          s.transitionType,
        ]),
      ).toEqual([
        [1, 'VEO: Ada crosses the hall (1).', 'Ada at the door (1).', 'cut'],
        [
          2,
          'VEO: Ada crosses the hall (2).',
          'Ada at the door (2).',
          'continuation',
        ],
      ]);
      expect(shots[0]!.ingredients).toEqual({
        characters: [
          {
            name: 'Ada',
            imageUrl: 'https://img.test/ada.png',
            localPath: null,
          },
        ],
        location: {
          name: 'Hall',
          imageUrl: 'https://img.test/hall.png',
          localPath: null,
        },
      });
    });

    it('start_voice_render queues one message per line, billed to the team, with the profile voice and the project model', async () => {
      const result = await call(client, 'start_voice_render', {
        episodeId: team.episodeId,
      });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        status: 'queued',
        totalLines: 2,
      });

      const messages = await drain(voiceQueue);
      expect(messages.map((m) => m.dialogueLineId).sort()).toEqual(
        [...lineIds].sort(),
      );
      for (const message of messages) {
        expect(message).toMatchObject({
          accountId: team.accountId,
          episodeId: team.episodeId,
          voiceId: 'voice-ada',
          ttsModel: 'eleven_multilingual_v2',
          userId: team.userId,
          batchJobId: result.structuredContent!.batchJobId,
        });
      }

      const status = await call(client, 'get_render_status', {
        episodeId: team.episodeId,
      });
      expect(status.structuredContent).toMatchObject({
        voice: {
          totalLines: 2,
          batch: {
            batchJobId: result.structuredContent!.batchJobId,
            status: 'processing',
            totalLines: 2,
          },
        },
      });
    });

    it('start_audio_render queues the audio-file-generation job for the cue and marks it generating', async () => {
      const result = await call(client, 'start_audio_render', {
        episodeId: team.episodeId,
        cueId,
      });

      expect(result.isError).toBeFalsy();
      const [message, ...rest_] = await drain(llmQueue);
      expect(rest_).toEqual([]);
      expect(message).toMatchObject({
        jobType: 'audio-file-generation',
        userId: team.userId,
        payload: {
          cueId,
          episodeId: team.episodeId,
          projectId: team.projectId,
          accountId: team.accountId,
          cueType: 'music',
          prompt: 'A slow piano under the hall.',
          durationSeconds: 12,
        },
      });

      const status = await call(client, 'get_render_status', {
        episodeId: team.episodeId,
      });
      expect(status.structuredContent).toMatchObject({
        audio: {
          byStatus: { generating: 1 },
          inFlightOrFailed: [{ id: cueId }],
        },
      });
    });

    it('a connection without studio:render may read the manifest but start nothing', async () => {
      const refused = await call(readOnly, 'start_voice_render', {
        episodeId: team.episodeId,
        dialogueLineId: lineIds[0],
        voiceId: 'voice-x',
      });

      expect(refused.isError).toBe(true);
      expect(refused.structuredContent).toMatchObject({ code: 'FORBIDDEN' });
      expect(await drain(voiceQueue)).toEqual([]);

      const manifest = await call(readOnly, 'get_veo_manifest', {
        episodeId: team.episodeId,
      });
      expect(manifest.isError).toBeFalsy();
    });

    it('no render made a model call: no llm_usage_analytics row for the team', async () => {
      const rows = await rest(
        `/rest/v1/llm_usage_analytics?account_id=eq.${team.accountId}&select=id`,
        { method: 'GET', token: SERVICE_ROLE_KEY },
      );

      expect(rows).toEqual([]);
    });
  },
);
