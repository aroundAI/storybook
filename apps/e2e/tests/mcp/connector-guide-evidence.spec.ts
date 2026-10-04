import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test } from '@playwright/test';

import {
  type Call,
  type ToolResult,
  WORLD,
  driveEpisode,
  linkedCast,
  outputs,
  patient,
  runStage,
} from '../../../../packages/features/studio-mcp/__tests__/helpers/all-stages-script';
import {
  insertRow,
  readRows,
  seedProject,
  seedTeamAccount,
  seedTeamForUser,
  uniqueStamp,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';
import { ConnectedAppsPageObject } from './connected-apps.po';
import {
  CALLBACK_PATH,
  MCP_URL,
  authorizeUrl,
  callbackParams,
  exchangeCode,
  pkce,
  registerClient,
} from './oauth-client';

/**
 * The screenshots in the "Connect Claude" guide
 * (apps/web/content/documentation/claude-connector.mdoc, FILM-1911), from
 * one real run: a team is seeded through the API, Claude's side is the
 * scripted MCP client the contract test uses, and every page is the app's
 * own. Not a guard: the specs it reuses hold those. Skipped unless
 * CAPTURE_EVIDENCE is set; files land in EVIDENCE_DIR, named as the guide
 * embeds them.
 *
 * Two things are staged rather than driven: the "Edited" badge (a hand
 * edit in the web app writes `generation_origin.kind = 'human'`; the spec
 * writes that value to one shot), and the revoked connection (revoked
 * through the page, as a person would).
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

// The dev server's "1 Issue" badge is not part of the product
const NO_DEV_OVERLAY = 'nextjs-portal { display: none !important; }';

const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:55321';
const ANON_KEY =
  process.env.E2E_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

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

test.describe('Connect Claude guide: screenshots', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 to regenerate the guide screenshots.',
  );

  test('every step of the guide, as it looks in the app', async ({ page }) => {
    test.setTimeout(300_000);
    // A dev server compiles each studio route on first visit
    page.setDefaultNavigationTimeout(90_000);

    const stamp = uniqueStamp().slice(0, 8);
    const team = await seedTeamAccount({
      emailPrefix: 'guide',
      name: `Harbour Films ${stamp}`,
    });
    await seedTeamForUser(team, `Night Shift Studio ${stamp}`);
    const project = await seedProject(team);
    const accessToken = await sessionToken(team.email, team.password);
    const settings = new ConnectedAppsPageObject(page);

    await signInAs(page, team);

    // 1. The consent page, then the grant the guide's step 5 makes
    const registered = await registerClient({ clientName: 'Claude' });
    const clientId = registered.body.client_id!;
    const { verifier, challenge } = pkce();

    await page.goto(authorizeUrl({ clientId, challenge }));
    await byTest(page, 'oauth-consent').waitFor();
    await byTest(page, 'oauth-consent').screenshot({
      path: `${OUT}/consent-page.png`,
    });

    await byTest(page, `oauth-consent-team-${team.slug}`).click();
    await byTest(page, 'oauth-consent-approve').click();
    await page.waitForURL((url) => url.pathname === CALLBACK_PATH);
    const { code } = callbackParams(new URL(page.url()));
    expect(
      (await exchangeCode({ code: code!, clientId, verifier })).status,
    ).toBe(200);

    // 2. A personal access token, shown once
    await settings.goTo(team.slug);
    const token = await settings.create('Claude Desktop', ['read', 'write']);
    await page.screenshot({
      path: `${OUT}/connected-apps-token.png`,
      style: NO_DEV_OVERLAY,
    });
    await settings.dismissReveal().click();

    // 3. Claude works: the cast, then every stage over MCP
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

      const [row] = await readRows<{ metadata: Record<string, unknown> }>(
        'episodes',
        `id=eq.${episode.id}&select=metadata`,
      );
      await updateRows('episodes', `id=eq.${episode.id}`, {
        metadata: linkedCast(row!.metadata, cast),
      });

      await driveEpisode(call, {
        projectId: project.id,
        episodeId: episode.id,
      });

      // The story written a second time, so a previous version exists
      await runStage(call, { stage: 'story', episodeId: episode.id }, () => ({
        story: {
          ...outputs.story().story,
          fullText: `${String(outputs.story().story.fullText)} Then the signal stops.`,
        },
      }));

      const base = `/home/${team.slug}/studio/${project.slug}/episodes/${episode.slug}`;

      // Claude's story, with the badge and the restore action
      await page.goto(`${base}/story`);
      await expect(byTest(page, 'story-content')).toContainText(
        'Then the signal stops.',
        { timeout: 60_000 },
      );
      await expect(
        byTest(byTest(page, 'stage-run-bar'), 'origin-badge'),
      ).toContainText('Claude via MCP');
      await page.screenshot({
        path: `${OUT}/studio-written-by-claude.png`,
        style: NO_DEV_OVERLAY,
      });

      // Restore: the confirmation, then the stage after restoring
      await byTest(page, 'restore-previous-version').click();
      await byTest(page, 'restore-previous-version-confirm').waitFor();
      await page.screenshot({
        path: `${OUT}/restore-confirm.png`,
        style: NO_DEV_OVERLAY,
      });
      await byTest(page, 'restore-previous-version-confirm').click();
      await expect(byTest(page, 'story-content')).not.toContainText(
        'Then the signal stops.',
      );
      await page.screenshot({
        path: `${OUT}/restore-after.png`,
        style: NO_DEV_OVERLAY,
      });

      // A screenplay and shots with Claude's badge, and one shot edited
      const [shot] = await readRows<{ id: string }>(
        'shots',
        `episode_id=eq.${episode.id}&select=id&order=sequence_number.asc&limit=1`,
      );
      await updateRows('shots', `id=eq.${shot!.id}`, {
        generation_origin: { kind: 'human', at: new Date().toISOString() },
      });
      await page.goto(`${base}/visual-studio`);
      const cards = byTest(page, 'shot-card');
      await expect(byTest(cards.first(), 'origin-badge')).toContainText(
        'Edited',
        { timeout: 60_000 },
      );
      await expect(byTest(cards.nth(1), 'origin-badge')).toContainText(
        'Claude via MCP',
      );
      await cards.first().scrollIntoViewIfNeeded();
      await page.setViewportSize({ width: 1280, height: 1000 });
      await cards.first().scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${OUT}/origin-badges-shots.png`,
        style: NO_DEV_OVERLAY,
      });
      await page.setViewportSize({ width: 1280, height: 720 });

      // An external run held open: the banner, with Generate paused
      const started = await call('start_generation', {
        stage: 'screenplay',
        episodeId: episode.id,
      });
      expect(started.isError).toBeFalsy();
      await page.goto(`${base}/screenplay`);
      await expect(byTest(page, 'external-run-banner')).toContainText(
        'Claude is working on this',
        { timeout: 60_000 },
      );
      await page.screenshot({
        path: `${OUT}/working-banner.png`,
        style: NO_DEV_OVERLAY,
      });
    } finally {
      await client.close();
    }

    // 4. Team settings → AI, as the owner
    await page.goto(`/home/${team.slug}/settings/ai`);
    await byTest(page, 'ai-settings-form').waitFor();
    await page.screenshot({
      path: `${OUT}/team-ai-settings.png`,
      style: NO_DEV_OVERLAY,
    });

    // 5. Your connections: the token and the grant active, then one revoked
    await settings.goTo(team.slug);
    await expect(settings.rows()).toHaveCount(2);
    await byTest(
      settings.row('Claude Desktop'),
      'mcp-connection-revoke',
    ).click();
    await byTest(page, 'mcp-connection-revoke-confirm').waitFor();
    await page.screenshot({
      path: `${OUT}/revoke-confirm.png`,
      style: NO_DEV_OVERLAY,
    });
    await byTest(page, 'mcp-connection-revoke-confirm').click();
    await expect(
      byTest(settings.row('Claude Desktop'), 'mcp-connection-status'),
    ).toHaveText('Revoked');
    await byTest(page, 'mcp-connections-card').screenshot({
      path: `${OUT}/your-connections.png`,
    });
  });
});
