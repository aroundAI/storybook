import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  SERVICE_ROLE_KEY,
  type SeededTeam,
  mintPat,
  rest,
  seedTeam,
} from './helpers/mcp-seed';

/**
 * KB-183, live: a team's existing character and location are linked to an
 * episode over MCP, and the screenplay that names them, refused before the
 * link, is accepted by submit_generation after it. Needs a running app (the
 * generation tools load the episode context there), like the story test:
 *
 *   MCP_CONTRACT_SEED=1 MCP_CONTRACT_URL=http://localhost:3216/api/mcp \
 *     E2E_SUPABASE_URL=http://127.0.0.1:55321 \
 *     pnpm --filter @kit/studio-mcp test link-assets.contract
 */
const URL_ = process.env.MCP_CONTRACT_URL;
const SEED = process.env.MCP_CONTRACT_SEED === '1';

type CallResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

const admin = (pathAndQuery: string) =>
  rest(pathAndQuery, { method: 'GET', token: SERVICE_ROLE_KEY });

const SCREENPLAY = {
  scenes: [
    {
      number: 1,
      heading: 'INT. OBSERVATION DECK - DAY',
      location: 'Observation Deck',
      timeOfDay: 'day',
      description: 'Maya floats at the window.',
      dialogue: [{ character: 'Maya Chen', text: '[calm] Houston, respond.' }],
      estimatedDuration: 30,
    },
  ],
};

describe.skipIf(!(SEED && URL_))(
  'linking existing assets over MCP, end to end (KB-183)',
  () => {
    let team: SeededTeam;
    let other: SeededTeam;
    let client: Client;
    let runId: string;
    let mayaId: string;
    let deckId: string;
    let foreignId: string;

    const call = (name: string, args: Record<string, unknown> = {}) =>
      client.callTool({ name, arguments: args }) as Promise<CallResult>;

    const submit = () =>
      call('submit_generation', {
        runId,
        partKey: 'scene-1',
        output: SCREENPLAY,
      });

    beforeAll(async () => {
      team = await seedTeam('link183');
      other = await seedTeam('link183b');

      await rest(`/rest/v1/episodes?id=eq.${team.episodeId}`, {
        method: 'PATCH',
        token: SERVICE_ROLE_KEY,
        body: {
          target_duration_seconds: 60,
          story_data: {
            fullStory: 'Maya hears her own voice on the comm.',
            tone: 'tense',
            actBreakdown: { act1: 'Setup', act2: 'Doubt', act3: 'Choice' },
            themes: ['identity'],
            characters: [{ name: 'Maya Chen', role: 'lead', arc: 'trusts' }],
            keyEvents: ['The comm crackles'],
            estimatedSceneCount: 1,
          },
        },
      });

      const ids = async (owner: SeededTeam, rows: object[]) =>
        (
          (await rest('/rest/v1/assets', {
            token: owner.token,
            prefer: 'return=representation',
            body: rows.map((row) => ({ project_id: owner.projectId, ...row })),
          })) as Array<{ id: string }>
        ).map((row) => row.id);

      const created = await ids(team, [
        { type: 'character', name: 'Maya Chen', description: 'Commander.' },
        { type: 'location', name: 'Observation Deck', description: 'Glass.' },
      ]);
      const foreign = await ids(other, [
        { type: 'character', name: 'Their Hero', description: 'Elsewhere.' },
      ]);

      if (!created[0] || !created[1] || !foreign[0]) {
        throw new Error('The seeded assets were not returned');
      }

      [mayaId, deckId, foreignId] = [created[0], created[1], foreign[0]];

      const token = await mintPat(team, ['studio:read', 'studio:write']);
      client = new Client({ name: 'Claude', version: '0' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(URL_!), {
          requestInit: { headers: { Authorization: `Bearer ${token}` } },
        }),
      );
    }, 90_000);

    afterAll(async () => {
      await client?.close();
    });

    it('a screenplay naming the team’s cast is refused while they are not linked', async () => {
      const started = await call('start_generation', {
        stage: 'screenplay',
        episodeId: team.episodeId,
      });
      expect(started.isError).toBeFalsy();
      runId = (started.structuredContent!.run as { runId: string }).runId;

      const refused = await submit();

      expect(refused.structuredContent).toMatchObject({ status: 'rejected' });
      const codes = (
        refused.structuredContent!.errors as Array<{ code: string }>
      ).map((error) => error.code);
      expect(codes).toEqual(
        expect.arrayContaining(['unknown_location', 'unknown_character']),
      );
    });

    it('another team’s asset is refused and nothing is linked', async () => {
      const refused = await call('link_assets_to_episode', {
        episodeId: team.episodeId,
        assetIds: [mayaId, foreignId],
      });

      expect(refused.isError).toBe(true);
      expect(refused.structuredContent).toMatchObject({
        code: 'VALIDATION_FAILED',
      });

      const [episode] = await admin(
        `/rest/v1/episodes?id=eq.${team.episodeId}&select=metadata`,
      );
      expect(episode.metadata.character_ids).toBeUndefined();
    });

    it('links the character and location, as the web header does, and the same screenplay is accepted', async () => {
      const linked = await call('link_assets_to_episode', {
        episodeId: team.episodeId,
        assetIds: [mayaId, deckId],
      });
      expect(linked.isError).toBeFalsy();

      const [episode] = await admin(
        `/rest/v1/episodes?id=eq.${team.episodeId}&select=metadata`,
      );
      expect(episode.metadata).toMatchObject({
        character_ids: [mayaId],
        character_names: ['Maya Chen'],
        location_ids: [deckId],
        location_names: ['Observation Deck'],
      });

      // The link moved the episode's version, so the run briefed before it
      // is closed (TARGET_CHANGED), as an edit in the web would close it.
      const closed = await submit();
      expect(closed.structuredContent).toMatchObject({
        code: 'TARGET_CHANGED',
      });

      const restarted = await call('start_generation', {
        stage: 'screenplay',
        episodeId: team.episodeId,
      });
      expect(restarted.isError).toBeFalsy();
      runId = (restarted.structuredContent!.run as { runId: string }).runId;

      const accepted = await submit();

      expect(accepted.isError).toBeFalsy();
      expect(accepted.structuredContent).toMatchObject({ status: 'accepted' });

      await call('cancel_generation', { runId });
    });
  },
);
