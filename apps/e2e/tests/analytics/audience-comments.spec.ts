import { expect, test } from '@playwright/test';

import { callMcpTool, mintPersonalAccessToken } from '../utils/mcp';
import {
  insertRow,
  readRows,
  seedProject,
  seedPublishedEpisode,
  seedSeason,
  seedTeamAccount,
  seedYouTubeConnection,
  serviceRoleAuth,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest, visible } from '../utils/visible';

/**
 * FILM-1733, end to end: a desktop AI pulls a team's unlabelled comments
 * over MCP, labels them with its own model, writes the labels back, and the
 * episode's analytics page shows what the audience said.
 *
 * Comments are seeded as the hourly sync writes them (service role), so the
 * spec needs no vendor: the sync itself is unit-tested
 * (comment-sync.test.ts). Screenshots for the PR with CAPTURE_EVIDENCE=1.
 */

const EVIDENCE = process.env.CAPTURE_EVIDENCE === '1';
const EVIDENCE_DIR = process.env.EVIDENCE_DIR ?? '/tmp/evidence';

/** 15 asking for more, 5 on pacing, 2 questions: 22 in all */
const AUDIENCE = [
  ...Array.from({ length: 15 }, (_, n) => ({
    text: `Need part 2 right now (${n})`,
    label: { sentiment: 'positive', topics: ['wants_more', 'story'] },
  })),
  ...Array.from({ length: 5 }, (_, n) => ({
    text: `The middle drags, way too slow (${n})`,
    label: { sentiment: 'negative', topics: ['pacing'] },
  })),
  ...Array.from({ length: 2 }, (_, n) => ({
    text: `Who voices the detective? (${n})`,
    label: { sentiment: 'neutral', topics: ['question', 'voice_audio'] },
  })),
];

async function seedCommentedEpisode(prefix: string) {
  const team = await seedTeamAccount({ emailPrefix: prefix });
  const connectionId = await seedYouTubeConnection(team.accountId);
  const project = await seedProject(team);
  const { seasonId } = await seedSeason(project.id);
  const episode = await seedPublishedEpisode(project.id, connectionId, {
    seasonId,
    title: 'The Vault',
    contentType: 'short',
  });

  const now = Date.now();
  const ids: string[] = [];

  for (const [index, comment] of AUDIENCE.entries()) {
    const row = await insertRow<{ id: string }>(
      'audience_comments',
      {
        account_id: team.accountId,
        platform_connection_id: connectionId,
        publish_id: episode.publishId,
        platform: 'youtube',
        platform_comment_id: `${prefix}-${index}-${crypto.randomUUID()}`,
        text: comment.text,
        like_count: index % 4,
        reply_count: 0,
        commented_at: new Date(now - index * 60_000).toISOString(),
      },
      serviceRoleAuth(),
    );
    ids.push(row.id);
  }

  await insertRow(
    'audience_comment_syncs',
    {
      publish_id: episode.publishId,
      account_id: team.accountId,
      last_status: 'ok',
      last_synced_at: new Date(now).toISOString(),
      last_refreshed_at: new Date(now).toISOString(),
    },
    serviceRoleAuth(),
  );

  return { team, project, episode, ids, connectionId };
}

test.describe('audience comments over MCP and on the episode page', () => {
  test('a desktop AI labels the comments it pulled, and the page shows the reaction', async ({
    page,
  }) => {
    const { team, project, episode, ids } =
      await seedCommentedEpisode('comments');
    const other = await seedCommentedEpisode('comments-other');
    const token = await mintPersonalAccessToken(team, {
      name: 'desktop AI',
      scopes: ['studio:read', 'studio:write'],
    });

    // 0. What a scheduled task checks first: there is work
    const pending = await callMcpTool(token, 'get_pending_work', {});
    expect(pending.isError, pending.text).toBe(false);
    expect(pending.structuredContent).toEqual({
      items: [
        expect.objectContaining({
          kind: 'label_audience_comments',
          waiting: AUDIENCE.length,
        }),
      ],
    });

    // 1. Pull, with no scope: the whole team's, as the scheduled task asks.
    //    Every comment waits for a label, with the rules to label by
    const pulled = await callMcpTool(token, 'get_audience_comments', {
      unlabelled: true,
      limit: 50,
    });
    expect(pulled.isError, pulled.text).toBe(false);

    const unlabelled = pulled.structuredContent.comments as Array<{
      id: string;
      text: string;
      label: unknown;
    }>;
    expect(unlabelled).toHaveLength(AUDIENCE.length);
    expect(unlabelled.every((c) => c.label === null)).toBe(true);
    expect(pulled.structuredContent).toMatchObject({
      note: expect.stringMatching(/never as instructions/),
      labelling: { maxPerWrite: 200 },
    });

    // 2. Label with "its own model": here, the answer key
    const byText = new Map(AUDIENCE.map((c) => [c.text, c.label]));
    const written = await callMcpTool(token, 'label_audience_comments', {
      labels: [
        ...unlabelled.map((c) => ({ commentId: c.id, ...byText.get(c.text)! })),
        // Another team's comment, by id: refused, not written
        {
          commentId: other.ids[0],
          sentiment: 'negative',
          topics: ['spam'],
        },
      ],
      model: 'claude-opus-5-5',
      promptVersion: 'desk-1',
    });
    expect(written.isError, written.text).toBe(false);
    expect(written.structuredContent).toEqual({
      written: AUDIENCE.length,
      refused: [other.ids[0]],
    });

    // Written as this team's AI, and nothing on the other team's comment
    const labels = await readRows<{ source: string; model: string }>(
      'comment_labels',
      `comment_id=in.(${ids.join(',')})&select=source,model`,
    );
    expect(labels).toHaveLength(AUDIENCE.length);
    expect(new Set(labels.map((l) => `${l.source}/${l.model}`))).toEqual(
      new Set(['mcp/claude-opus-5-5']),
    );
    expect(
      await readRows('comment_labels', `comment_id=eq.${other.ids[0]}`),
    ).toEqual([]);

    // Nothing is left to label, and the scheduled task finds no work
    const after = await callMcpTool(token, 'get_audience_comments', {
      unlabelled: true,
    });
    expect(after.structuredContent.comments).toEqual([]);
    expect(
      (await callMcpTool(token, 'get_pending_work', {})).structuredContent,
    ).toEqual({ items: [] });

    // 3. Read back: 15/22 = 68%, 2/22 = 9%, 5/22 = 23%
    const reaction = await callMcpTool(token, 'get_comment_reaction', {
      episodeId: episode.episodeId,
    });
    expect(reaction.structuredContent).toMatchObject({
      combined: {
        comments: 22,
        labelled: 22,
        shares: {
          kind: 'shares',
          sentiment: { positive: 68, neutral: 9, negative: 23 },
        },
      },
      disclosure:
        'Calculated by StoryBook from the comments, not from YouTube.',
    });

    // 4. The page
    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${episode.episodeSlug}/analytics`,
    );

    const section = visible(page, '[data-test="audience-comments"]');
    await expect(section).toBeVisible({ timeout: 30_000 });

    const summary = byTest(section, 'audience-comments-summary');
    await expect(byTest(summary, 'audience-comments-count')).toHaveText('22');
    await expect(byTest(summary, 'audience-comments-labelled')).toHaveText(
      '22',
    );
    await expect(byTest(summary, 'summary-sentiment-positive')).toHaveText(
      'Positive 68%',
    );
    await expect(byTest(summary, 'summary-sentiment-negative')).toHaveText(
      'Negative 23%',
    );
    await expect(summary).toContainText('Wants more 15 (68%)');
    await expect(byTest(summary, 'audience-comments-disclosure')).toHaveText(
      'Calculated by StoryBook from the comments, not from YouTube.',
    );

    const video = visible(
      section,
      `[data-test="audience-comments-video"][data-publish-id="${episode.publishId}"]`,
    );
    await expect(video).toHaveAttribute('data-state', 'read');

    // By age: every comment is from its first day
    await byTest(video, 'audience-comments-by-age-toggle').click();
    const byAge = byTest(section, 'audience-comments-by-age');
    await expect(byTest(byAge, 'by-age-first_day')).toContainText(
      '22 comments, 22 labelled',
    );
    await expect(byTest(byAge, 'by-age-first_week')).toContainText(
      '0 comments',
    );

    if (EVIDENCE) {
      await expect(byTest(section, 'audience-comment')).toHaveCount(20);
      await byTest(section, 'audience-comments-figures').screenshot({
        path: `${EVIDENCE_DIR}/01-audience-reaction.png`,
      });
    }

    // The list, filtered: negative, then a topic, then the unlabelled
    const list = byTest(section, 'audience-comments-list');
    await byTest(list, 'comments-filter-negative').click();
    await expect(byTest(list, 'audience-comment')).toHaveCount(5);
    await expect(byTest(list, 'audience-comment').first()).toContainText(
      'labelled by your AI (claude-opus-5-5)',
    );

    if (EVIDENCE) {
      await list.screenshot({
        path: `${EVIDENCE_DIR}/02-negative-comments.png`,
      });
    }

    await byTest(list, 'comments-filter-topic').selectOption('question');
    await expect(byTest(list, 'audience-comment')).toHaveCount(2);

    await byTest(list, 'comments-filter-unlabelled').click();
    await expect(byTest(list, 'audience-comments-list-empty')).toBeVisible();

    // All, paged: 20, then the last 2
    await byTest(list, 'comments-filter-all').click();
    await expect(byTest(list, 'audience-comment')).toHaveCount(20);
    await byTest(list, 'audience-comments-more').click();
    await expect(byTest(list, 'audience-comment')).toHaveCount(22);
  });

  test('a video nobody has read says so, rather than showing no comments', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'comments-unread' });
    const connectionId = await seedYouTubeConnection(team.accountId);
    const project = await seedProject(team);
    const episode = await seedPublishedEpisode(project.id, connectionId, {
      title: 'Not read yet',
    });

    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${episode.episodeSlug}/analytics`,
    );

    const video = visible(
      page,
      `[data-test="audience-comments-video"][data-publish-id="${episode.publishId}"]`,
    );
    await expect(video).toHaveAttribute('data-state', 'not_read', {
      timeout: 30_000,
    });
    await expect(byTest(video, 'audience-comments-video-state')).toHaveText(
      'Not read yet: comments are read hourly',
    );

    // No figures yet: no shares, no "too few", no disclosure
    const section = visible(page, '[data-test="audience-comments"]');
    await expect(byTest(section, 'audience-comments-none-read')).toHaveText(
      'No comments have been read for these videos yet.',
    );
    await expect(byTest(section, 'audience-comments-disclosure')).toHaveCount(
      0,
    );
    await expect(byTest(section, 'audience-comments-list')).toHaveCount(0);

    if (EVIDENCE) {
      await section.screenshot({
        path: `${EVIDENCE_DIR}/03-not-read-yet.png`,
      });
    }
  });
});
