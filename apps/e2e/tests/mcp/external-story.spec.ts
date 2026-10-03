import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { insertRow, seedProject, seedTeamAccount } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';
import { MCP_URL } from './oauth-client';

/**
 * FILM-1908: Claude writes an episode's story over MCP and StoryBook makes
 * no model call. A scripted SDK client, with a personal access token,
 * creates the episode, starts the story stage, has one submission refused
 * and the next accepted (which commits it, the story being one part); then
 * the web story page shows that story. The origin badge is FILM-1910's: the
 * stamped origin is read here through get_episode.
 *
 * Screenshots for the PR are written only when CAPTURE_EVIDENCE is set.
 */
const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:55321';
const ANON_KEY =
  process.env.E2E_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const EVIDENCE = process.env.CAPTURE_EVIDENCE
  ? (process.env.EVIDENCE_DIR ?? 'evidence')
  : null;

const SUBMISSION = JSON.parse(
  readFileSync(
    path.resolve(
      __dirname,
      '../../../../packages/features/studio-mcp/__tests__/fixtures/story-submission.json',
    ),
    'utf8',
  ),
).output as { story: Record<string, unknown> };

type ToolResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

async function sessionToken(email: string, password: string) {
  const response = await fetch(
    `${SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    },
  );

  return ((await response.json()) as { access_token: string }).access_token;
}

/** A token as Settings → Connected apps makes one (FILM-1904). */
async function mintToken(accountId: string, accessToken: string) {
  const token = `sbk_pat_${randomBytes(32).toString('base64url')}`;
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/rpc/create_mcp_personal_access_token`,
    {
      method: 'POST',
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_account_id: accountId,
        p_name: 'Claude Desktop',
        p_scopes: ['studio:read', 'studio:write'],
        p_token_hash: createHash('sha256').update(token, 'utf8').digest('hex'),
      }),
    },
  );

  expect(response.ok).toBe(true);

  return token;
}

test.describe('Claude writes the story over MCP (FILM-1908)', () => {
  test('the scripted run commits the story and the story page shows it', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const team = await seedTeamAccount({ emailPrefix: 'film1908' });
    const project = await seedProject(team);
    const accessToken = await sessionToken(team.email, team.password);

    // The project's cast, so the story's characters are known ones
    for (const [type, name] of [
      ['character', 'Maya Chen'],
      ['character', 'Director Williams'],
      ['location', 'Observation Deck'],
    ]) {
      await insertRow(
        'assets',
        { project_id: project.id, type, name, description: name },
        { key: ANON_KEY, token: accessToken },
      );
    }

    const token = await mintToken(team.accountId, accessToken);
    const client = new Client({ name: 'Claude', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(MCP_URL), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );

    const call = (name: string, args: Record<string, unknown>) =>
      client.callTool({ name, arguments: args }) as Promise<ToolResult>;

    let episodeSlug: string;

    try {
      const created = await call('create_episode', {
        projectId: project.id,
        title: 'The Last Signal',
        description:
          'A lonely astronaut hears a signal that carries her own voice.',
        targetDuration: 300,
        contentStyle: 'dialogue-heavy',
      });
      expect(created.isError).toBeFalsy();
      const episode = created.structuredContent!.episode as {
        id: string;
        slug: string;
      };
      episodeSlug = episode.slug;

      const started = await call('start_generation', {
        stage: 'story',
        episodeId: episode.id,
      });
      expect(started.isError).toBeFalsy();
      const runId = (started.structuredContent!.run as { runId: string }).runId;

      // First submission: no story text. Refused, field by field
      const { fullText: _missing, ...noText } = SUBMISSION.story;
      const refused = await call('submit_generation', {
        runId,
        partKey: 'story',
        output: { ...SUBMISSION, story: noText },
      });
      expect(refused.structuredContent).toMatchObject({
        status: 'rejected',
        errors: [expect.objectContaining({ path: 'story.fullText' })],
      });

      // Second submission: accepted, and committed (story is one part)
      const accepted = await call('submit_generation', {
        runId,
        partKey: 'story',
        output: SUBMISSION,
        model: 'claude-e2e',
      });
      expect(accepted.structuredContent).toMatchObject({
        status: 'accepted',
        finalized: { status: 'committed' },
      });

      const read = await call('get_episode', { episodeId: episode.id });
      expect(read.isError).toBeFalsy();
      expect(JSON.stringify(read.structuredContent)).toMatch(
        /"story":\{[^}]*"kind":"external"/,
      );
      expect(JSON.stringify(read.structuredContent)).toContain(
        '"clientName":"Claude Desktop"',
      );
    } finally {
      await client.close();
    }

    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${episodeSlug}/story`,
    );

    const story = byTest(page, 'story-content');
    await expect(story).toContainText(
      'Commander Maya Chen floats in the silence of the observation deck.',
    );

    if (EVIDENCE) {
      await page.screenshot({
        path: `${EVIDENCE}/film-1908-01-story-page.png`,
        fullPage: false,
      });
    }

    // After a reload the page reads the committed row, not client state
    await page.reload();
    await expect(byTest(page, 'story-content')).toContainText(
      'Commander Maya Chen',
    );

    if (EVIDENCE) {
      await page.screenshot({
        path: `${EVIDENCE}/film-1908-02-story-after-reload.png`,
        fullPage: false,
      });
    }
  });
});
