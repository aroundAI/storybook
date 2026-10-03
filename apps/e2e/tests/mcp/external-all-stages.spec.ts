import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { type Page, expect, test } from '@playwright/test';
import { createHash, randomBytes } from 'node:crypto';

import {
  type Call,
  SHOTS_PER_SCENE,
  type ToolResult,
  WORLD,
  driveEpisode,
  linkedCast,
  patient,
} from '../../../../packages/features/studio-mcp/__tests__/helpers/all-stages-script';
import { insertRow, seedProject, seedTeamAccount } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';
import { MCP_URL } from './oauth-client';

/**
 * FILM-1909: Claude takes an episode from ideation to audio cues over MCP
 * and StoryBook makes no model call. The scripted client (the one the
 * contract test runs) drives ideation → story → screenplay → shots → audio
 * cues; the studio pages then show each stage's result, read from the rows
 * the commits wrote, before and after a reload, each with FILM-1910's
 * "Claude via MCP" badge where the page shows one (the story and the
 * screenplay in the stage bar, every shot card).
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

async function rest(
  pathAndQuery: string,
  token: string,
  init: { method?: string; body?: unknown } = {},
) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    method: init.method ?? 'GET',
    headers: {
      apikey: ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

  expect(response.ok, await response.clone().text()).toBe(true);

  return response.json() as Promise<Array<Record<string, unknown>>>;
}

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

/** FILM-1910's origin badge, inside the first element with this hook. */
async function expectWrittenByClaude(page: Page, within: string) {
  await expect(
    byTest(byTest(page, within).first(), 'origin-badge').first(),
  ).toContainText('Claude via MCP');
}

async function capture(page: Page, name: string) {
  if (EVIDENCE) {
    await page.screenshot({ path: `${EVIDENCE}/film-1909-${name}.png` });
  }
}

test.describe('Claude takes an episode through every stage over MCP (FILM-1909)', () => {
  test('ideation, story, screenplay, shots and audio cues land on the studio pages', async ({
    page,
  }) => {
    test.setTimeout(240_000);

    const team = await seedTeamAccount({ emailPrefix: 'film1909' });
    const project = await seedProject(team);
    const accessToken = await sessionToken(team.email, team.password);

    const cast: Array<{ id: string; name: string; type: string }> = [];

    for (const [type, name] of [
      ...WORLD.characters.map((name) => ['character', name]),
      ['location', WORLD.location],
    ] as Array<[string, string]>) {
      cast.push(
        await insertRow(
          'assets',
          { project_id: project.id, type, name, description: name },
          { key: ANON_KEY, token: accessToken },
        ),
      );
    }

    const token = await mintToken(team.accountId, accessToken);
    const client = new Client({ name: 'Claude', version: '1.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(MCP_URL), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );

    const call: Call = patient(
      (name, args) =>
        client.callTool({ name, arguments: args }) as Promise<ToolResult>,
    );

    let episode: { id: string; slug: string };
    let sceneCount = 0;

    try {
      const created = await call('create_episode', {
        projectId: project.id,
        title: 'The Last Signal',
        description:
          'A lonely astronaut hears a signal that carries her own voice.',
        targetDuration: 180,
        contentStyle: 'dialogue-heavy',
      });
      expect(created.isError).toBeFalsy();
      episode = created.structuredContent!.episode as typeof episode;

      // The cast linked on the web, as the episode header's link action does
      const [row] = await rest(
        `episodes?id=eq.${episode.id}&select=metadata`,
        accessToken,
      );
      await rest(`episodes?id=eq.${episode.id}`, accessToken, {
        method: 'PATCH',
        body: {
          metadata: linkedCast(row!.metadata as Record<string, unknown>, cast),
        },
      });

      const { runs } = await driveEpisode(call, {
        projectId: project.id,
        episodeId: episode.id,
      });
      expect(runs.map((run) => run.stage)).toEqual([
        'ideation',
        'story',
        'screenplay',
        'shots',
        'audio_cues',
      ]);
      sceneCount = runs.find((run) => run.stage === 'shots')!.parts.length - 1;
    } finally {
      await client.close();
    }

    await signInAs(page, team);
    const base = `/home/${team.slug}/studio/${project.slug}/episodes/${episode!.slug}`;

    for (const reload of [false, true]) {
      const suffix = reload ? '-after-reload' : '';

      await page.goto(`${base}/ideation`);
      if (reload) await page.reload();
      await expect(byTest(page, 'idea-card')).toHaveCount(2);
      await expect(byTest(page, 'idea-card').first()).toContainText(
        'An astronaut hears a signal that carries her own voice.',
      );
      await byTest(page, 'idea-card').first().scrollIntoViewIfNeeded();
      await capture(page, `01-ideation${suffix}`);

      await page.goto(`${base}/story`);
      if (reload) await page.reload();
      await expect(byTest(page, 'story-content')).toContainText(
        'Commander Maya Chen',
      );
      await expectWrittenByClaude(page, 'stage-run-bar');
      await capture(page, `02-story${suffix}`);

      await page.goto(`${base}/screenplay`);
      if (reload) await page.reload();
      await expect(byTest(page, 'scene-index-item-1')).toBeVisible();
      await expect(
        page.getByText('Signal 1. It is my voice.').first(),
      ).toBeVisible();
      await expectWrittenByClaude(page, 'stage-run-bar');
      await capture(page, `03-screenplay${suffix}`);

      await page.goto(`${base}/visual-studio`);
      if (reload) await page.reload();
      await expect(byTest(page, 'shot-card').first()).toBeVisible();
      await expect(byTest(page, 'shot-card')).toHaveCount(
        sceneCount * SHOTS_PER_SCENE,
      );
      await expectWrittenByClaude(page, 'shot-card');
      await capture(page, `04-shots${suffix}`);

      await page.goto(`${base}/audio-studio`);
      if (reload) await page.reload();
      await byTest(page, 'audio-tab-sfx').click();
      await expect(byTest(page, 'sfx-cue-meta').first()).toContainText(
        'ambient',
      );
      await expect(byTest(page, 'sfx-cue-meta')).toHaveCount(sceneCount);
      await capture(page, `05-audio-cues${suffix}`);
    }
  });
});
