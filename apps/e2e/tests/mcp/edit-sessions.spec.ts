import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { expect, test } from '@playwright/test';

import { callMcpTool, mintPersonalAccessToken } from '../utils/mcp';
import {
  type SeededTeam,
  readRows,
  seedEpisodeWorkspace,
  seedMembership,
  seedProject,
  seedProjectMember,
  seedTeamAccount,
  seedUser,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';
import { MCP_URL } from './oauth-client';

/**
 * FILM-2002: an episode remembers who is editing it in StorybookStudio.
 *
 * 1. An SDK client (as the Studio's will be, FILM-2011) opens a session,
 *    records events, replays them, and closes; a second project member's
 *    open is RUN_IN_PROGRESS with who and since; a session left idle for a
 *    day is closed by the hourly cron route, with its bearer.
 * 2. The episode header and the episode list show "Editing in Studio" after
 *    open_edit_session over HTTP, and stop after close_edit_session; a
 *    second open shows it again.
 *
 * Fixtures are seeded through the API. Screenshots for the PR are written
 * only when CAPTURE_EVIDENCE is set.
 */
const EVIDENCE = process.env.CAPTURE_EVIDENCE
  ? (process.env.EVIDENCE_DIR ?? 'evidence')
  : null;

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

type ToolResult = {
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};

const ts = () => new Date().toISOString();

const events = [
  {
    clientEventId: 'plan-1-proposed',
    ts: ts(),
    type: 'plan_proposed',
    data: { planId: 'plan-1', by: 'ai', intent: 'hit_duration', steps: 7 },
  },
  {
    clientEventId: 'plan-1-approved',
    ts: ts(),
    type: 'plan_approved',
    data: { planId: 'plan-1', versionId: 'v2' },
  },
  {
    clientEventId: 'v2',
    ts: ts(),
    type: 'version_created',
    data: { versionId: 'v2', durationSeconds: 91.2, aiOps: 7, userOps: 1 },
  },
  {
    clientEventId: 'qa-1',
    ts: ts(),
    type: 'qa_run',
    data: { versionId: 'v2', pass: true, issues: 0 },
  },
];

async function readyEpisode(team: SeededTeam) {
  const project = await seedProject(team);
  const episode = await seedEpisodeWorkspace(project.id);

  await updateRows('episodes', `id=eq.${episode.episodeId}`, {
    status: 'ready',
  });

  return { project, ...episode };
}

async function episodeRow(episodeId: string) {
  const [row] = await readRows<{
    status: string;
    edit_state: Record<string, unknown>;
  }>('episodes', `id=eq.${episodeId}&select=status,edit_state`);

  return row!;
}

test.describe('edit sessions over MCP (FILM-2002)', () => {
  test('open, record, replay and close with the SDK client; a second user is RUN_IN_PROGRESS; an idle session is closed by the cron', async () => {
    test.setTimeout(120_000);

    const team = await seedTeamAccount({ emailPrefix: 'film2002' });
    const { project, episodeId } = await readyEpisode(team);

    // A second member of the same project, with their own token
    const other = await seedUser('film2002-other');
    await seedMembership(other.userId, team.accountId);
    await seedProjectMember(project.id, other.userId, 'member');
    const otherToken = await mintPersonalAccessToken({
      ...other,
      accountId: team.accountId,
    });

    const token = await mintPersonalAccessToken(team, { name: 'Studio' });
    const client = new Client({ name: 'StorybookStudio', version: '0.0.0' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(MCP_URL), {
        requestInit: { headers: { Authorization: `Bearer ${token}` } },
      }),
    );

    const call = (name: string, args: Record<string, unknown>) =>
      client.callTool({ name, arguments: args }) as Promise<ToolResult>;

    try {
      const opened = await call('open_edit_session', {
        episodeId,
        packageEtag: 'ep@v1',
      });
      expect(opened.isError).toBeFalsy();
      expect(opened.structuredContent).toMatchObject({
        previousStatus: 'ready',
        existing: false,
      });
      const sessionId = opened.structuredContent!.sessionId as string;

      expect(await episodeRow(episodeId)).toMatchObject({
        status: 'editing',
        edit_state: { sessionId, editedIn: 'studio' },
      });

      // The connection is recorded as the session's device
      const [session] = await readRows<{ connection_id: string | null }>(
        'edit_sessions',
        `id=eq.${sessionId}&select=connection_id`,
      );
      expect(session?.connection_id).toBeTruthy();

      // The same user opening again gets the same session
      const again = await call('open_edit_session', {
        episodeId,
        packageEtag: 'ep@v2',
      });
      expect(again.structuredContent).toMatchObject({
        sessionId,
        existing: true,
      });

      // Another project member is told who has it and since when
      const blocked = await callMcpTool(otherToken, 'open_edit_session', {
        episodeId,
        packageEtag: 'ep@v1',
      });
      expect(blocked.isError).toBe(true);
      expect(blocked.structuredContent).toMatchObject({
        code: 'RUN_IN_PROGRESS',
        details: { holder: { sessionId, userId: team.userId } },
      });

      // Record, then the same batch again: nothing stored twice
      const recorded = await call('record_edit_events', { sessionId, events });
      expect(recorded.structuredContent).toMatchObject({
        accepted: 4,
        duplicates: 0,
      });
      const replayed = await call('record_edit_events', { sessionId, events });
      expect(replayed.structuredContent).toMatchObject({
        accepted: 0,
        duplicates: 4,
      });

      // An unknown type is refused, field by field
      const refused = await call('record_edit_events', {
        sessionId,
        events: [{ ...events[0], clientEventId: 'x', type: 'session_opened' }],
      });
      expect(refused.isError).toBe(true);
      expect(refused.structuredContent).toMatchObject({
        code: 'VALIDATION_FAILED',
      });

      const closed = await call('close_edit_session', { sessionId });
      expect(closed.isError).toBeFalsy();
      expect(closed.structuredContent).toMatchObject({
        status: 'closed',
        restoredStatus: 'ready',
        summary: {
          versions: 1,
          finalDuration: 91.2,
          aiOps: 7,
          userOps: 1,
          plansProposed: 1,
          plansApproved: 1,
          qaRuns: 1,
        },
      });
      expect((await episodeRow(episodeId)).status).toBe('ready');

      // A closed session refuses events
      const late = await call('record_edit_events', {
        sessionId,
        events: [{ ...events[3], clientEventId: 'qa-late' }],
      });
      expect(late.structuredContent).toMatchObject({
        code: 'VALIDATION_FAILED',
      });

      // get_episode shows no open session now
      const read = await call('get_episode', { episodeId });
      expect(read.structuredContent).toMatchObject({ editSession: null });

      // A session idle for a day is closed by the hourly cron route
      const stale = await call('open_edit_session', {
        episodeId,
        packageEtag: 'ep@v3',
      });
      const staleId = stale.structuredContent!.sessionId as string;
      await updateRows('edit_sessions', `id=eq.${staleId}`, {
        last_event_at: new Date(Date.now() - 25 * 3_600_000).toISOString(),
      });

      const secret = process.env.CRON_SECRET;
      test.skip(!secret, 'Needs CRON_SECRET (deployment/config/local.env)');

      const unauthorised = await fetch(
        `${BASE_URL}/api/cron/expire-generation-runs`,
        { headers: { Authorization: 'Bearer wrong' } },
      );
      expect(unauthorised.status).toBe(401);
      expect((await episodeRow(episodeId)).status).toBe('editing');

      const cron = await fetch(`${BASE_URL}/api/cron/expire-generation-runs`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      expect(cron.status).toBe(200);
      const cronBody = (await cron.json()) as {
        staleEditSessions: { closed: number };
      };
      expect(cronBody.staleEditSessions.closed).toBeGreaterThanOrEqual(1);

      const [closedStale] = await readRows<{
        status: string;
        close_reason: string;
      }>('edit_sessions', `id=eq.${staleId}&select=status,close_reason`);
      expect(closedStale).toEqual({ status: 'closed', close_reason: 'stale' });
      expect((await episodeRow(episodeId)).status).toBe('ready');
    } finally {
      await client.close();
    }
  });

  test('the episode header and list show "Editing in Studio" while a session is open', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const team = await seedTeamAccount({ emailPrefix: 'film2002-badge' });
    const { project, episodeId, slug } = await readyEpisode(team);
    const token = await mintPersonalAccessToken(team, { name: 'Studio' });
    const editorName = team.email.split('@')[0]!;

    // a stage page: the episode root redirects to ideation, whose actions
    // keep the page busy
    const episodeUrl = `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/story`;
    const listUrl = `/home/${team.slug}/studio/${project.slug}/episodes`;

    await signInAs(page, team);

    // Before: no badge
    await page.goto(episodeUrl);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(byTest(page, 'editing-in-studio-badge')).toHaveCount(0);

    for (const round of [1, 2]) {
      const opened = await callMcpTool(token, 'open_edit_session', {
        episodeId,
        packageEtag: `ep@round${round}`,
      });
      expect(opened.isError).toBe(false);
      const sessionId = opened.structuredContent.sessionId as string;

      await page.goto(episodeUrl);
      const badge = byTest(page, 'editing-in-studio-badge');
      await expect(badge).toBeVisible();
      await expect(byTest(badge, 'editing-in-studio-editor')).toHaveText(
        editorName,
      );
      await expect(badge).toContainText('Editing in Studio by');

      if (EVIDENCE) {
        await page.screenshot({
          path: `${EVIDENCE}/film-2002-0${round}-header-editing.png`,
        });
      }

      await page.waitForLoadState('networkidle');
      await page.goto(listUrl);
      await expect(byTest(page, 'editing-in-studio-badge')).toHaveCount(1);
      await expect(byTest(page, 'editing-in-studio-editor')).toHaveText(
        editorName,
      );

      if (EVIDENCE && round === 1) {
        await page.screenshot({
          path: `${EVIDENCE}/film-2002-03-list-editing.png`,
        });
      }

      const closed = await callMcpTool(token, 'close_edit_session', {
        sessionId,
      });
      expect(closed.isError).toBe(false);

      await page.goto(episodeUrl);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await expect(byTest(page, 'editing-in-studio-badge')).toHaveCount(0);
      await expect(page.getByText('Ready', { exact: true })).toBeVisible();

      if (EVIDENCE && round === 1) {
        await page.screenshot({
          path: `${EVIDENCE}/film-2002-04-header-after-close.png`,
        });
      }

      await page.waitForLoadState('networkidle');
      await page.goto(listUrl);
      await expect(page.getByText(`Seeded Episode 1`)).toBeVisible();
      await expect(byTest(page, 'editing-in-studio-badge')).toHaveCount(0);
    }
  });
});
