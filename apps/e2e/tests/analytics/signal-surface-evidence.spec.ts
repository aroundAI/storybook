import { expect, test } from '@playwright/test';

import {
  clickHouseDate,
  clickHouseDateTime,
  daysAgo,
  insertClickHouse,
} from '../utils/clickhouse';
import { insertRow, seedPublishedVideos, serviceRoleAuth } from '../utils/seed';
import { byTest, visible } from '../utils/visible';
import { VideoLogPageObject } from './video-log.po';

/**
 * Signal Surfaces with figures in them (FILM-1719).
 *
 * The spec's fixture, on one screen: a YouTube Short whose Reach is unbound
 * (YouTube reports no impressions for a Short), Hook and Monetisation dark,
 * Attention judged below its cohort, Transmission against peers whose
 * typical figure is zero, and Audience with no figure for this video. The
 * assertion is that all five differ in the DOM, not that the page renders.
 *
 * Hand-computed: the subject averages 10 s a view over its first 30 days;
 * its 20 peers average 30..49 s, so typical (the median) is 39.5 s and the
 * subject is below the 34.75 s lower quartile. Every peer has 0 shares,
 * so the typical share rate is zero and Transmission is not compared. The
 * subject has no subscriber rows, so Audience has no figure.
 *
 * Needs ClickHouse, so it is gated like the other evidence specs.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

const PEERS = 20;
const CHECKPOINT = 30;

test.describe('FILM-1719 — signal surfaces with data', () => {
  test.skip(
    !process.env.CLICKHOUSE_EVIDENCE,
    'Set CLICKHOUSE_EVIDENCE=1 (needs a ClickHouse container).',
  );

  test.describe.configure({ timeout: 180_000 });

  test('keeps the five empty states apart, and every claim beside its evidence', async ({
    page,
  }) => {
    const videoLog = new VideoLogPageObject(page);
    const fixture = await videoLog.setup();
    const { project, team, connectionId } = fixture;

    const titles = [
      'Subject short',
      ...Array.from({ length: PEERS }, (_, i) => `Peer short ${i + 1}`),
    ];
    const ids = await seedPublishedVideos(project.id, connectionId, titles);
    const [subjectId, ...peerIds] = ids as [string, ...string[]];

    const publishedAt = (index: number) =>
      index === 0 ? daysAgo(60) : daysAgo(100 + index * 5);
    // Peers 15..20 (the longest-watched) and peer 1 carry result_first:yes;
    // the rest, and the subject, carry no — a mechanism on the winners.
    const resultFirst = (index: number) =>
      index >= 15 || index === 1 ? 'result_first:yes' : 'result_first:no';

    await insertClickHouse(
      'video_dim',
      ids.map((videoId, index) => ({
        video_id: videoId,
        project_id: project.id,
        account_id: team.accountId,
        connection_id: connectionId,
        episode_id: '00000000-0000-0000-0000-000000000000',
        platform: 'youtube',
        content_type: 'short',
        asset_duration_seconds: 45,
        language: 'en',
        channel_language: 'en',
        title: titles[index],
        published_at: clickHouseDateTime(publishedAt(index)),
        episode_duration_seconds: 600,
        tags: ['topic:ai', resultFirst(index)],
        updated_at: clickHouseDateTime(new Date()),
      })),
    );

    // 30 days each, 100 views a day. Watch time sets the average view
    // duration: 10 s for the subject, 30 + (i - 1) s for peer i.
    const rows = ids.flatMap((videoId, index) =>
      Array.from({ length: CHECKPOINT }, (_, day) => ({
        project_id: project.id,
        video_id: videoId,
        platform: 'youtube',
        metric_date: clickHouseDate(
          new Date(publishedAt(index).getTime() + day * 86_400_000),
        ),
        views: 100,
        likes: 0,
        comments: 0,
        shares: index === 0 ? 1 : 0,
        saves: 0,
        watch_time_seconds: 100 * (index === 0 ? 10 : 29 + index),
        subscribers_gained: index === 0 ? null : 1,
        subscribers_lost: 0,
        avg_view_duration_seconds: index === 0 ? 10 : 29 + index,
        avg_view_percentage: 40,
        dislikes: 0,
      })),
    );
    await insertClickHouse('video_metrics', rows);

    // A concluded Change log entry that confirmed the mechanism at Attention:
    // the only thing that may make a claim causal (FILM-1610, FILM-1717).
    await insertRow(
      'analytics_experiments',
      {
        account_id: team.accountId,
        connection_id: connectionId,
        title: 'Lead with the result',
        change_description: 'Open on the finished result',
        status: 'concluded',
        started_at: clickHouseDate(daysAgo(90)),
        ended_at: new Date(daysAgo(10)).toISOString(),
        outcome_status: 'confirmed',
        genome_hypothesis: 'result_first:yes@attention',
      },
      serviceRoleAuth(),
    );

    await videoLog.goToAnalytics(team.slug, project.slug);
    await videoLog.openVideoLog();

    await byTest(
      videoLog.rows().filter({ hasText: 'Subject short' }),
      'video-log-signals',
    ).click();

    // Tall enough that the surface is inside the viewport whole: the app
    // scrolls in its own container, so an element screenshot of anything
    // below the fold comes out blank.
    await page.setViewportSize({ width: 1280, height: 4000 });

    const surface = byTest(page, 'signal-surface');
    await expect(surface).toHaveAttribute('data-video-id', subjectId);
    const strip = byTest(surface, 'stage-strip');
    await expect(strip).toBeVisible();

    const cell = (stage: string) =>
      visible(strip, `[data-test="stage-cell"][data-stage="${stage}"]`);

    // The five states, from the DOM.
    const states = await byTest(strip, 'stage-cell').evaluateAll((cells) =>
      cells.map((c) => [
        c.getAttribute('data-stage'),
        c.getAttribute('data-stage-state'),
        c.getAttribute('data-band'),
      ]),
    );
    expect(states).toEqual([
      ['reach', 'unbound', null],
      ['hook', 'dark', null],
      ['attention', 'judged', 'below'],
      ['transmission', 'insufficient_cohort', null],
      ['audience', 'not_judgable', null],
      ['monetisation', 'dark', null],
    ]);

    // not_judgable and insufficient_cohort keep the measured value where one exists.
    await expect(byTest(cell('transmission'), 'stage-value')).toHaveText(
      // 30 shares over 3,000 views.
      '1.0%',
    );
    await expect(byTest(cell('audience'), 'stage-value')).toHaveCount(0);
    await expect(byTest(cell('audience'), 'stage-reason')).toHaveText(
      'The platform reported no figure for this video at this checkpoint.',
    );

    // No zero-length bar: every bar has a size, and only Attention has any.
    const bars = await strip.locator('[data-bar]').evaluateAll((els) =>
      els.map((el) => {
        const box = el.getBoundingClientRect();
        return {
          stage: el.closest('[data-stage]')?.getAttribute('data-stage'),
          width: box.width,
          height: box.height,
        };
      }),
    );
    expect(bars.length).toBe(3);
    for (const bar of bars) {
      expect(bar.stage).toBe('attention');
      expect(bar.width).toBeGreaterThan(0);
      expect(bar.height).toBeGreaterThan(0);
    }

    // The judged count, beside the diagnosis.
    await expect(byTest(surface, 'signal-coverage')).toHaveAttribute(
      'data-judged-count',
      '1',
    );
    await expect(byTest(surface, 'signal-coverage')).toContainText(
      'Judged on 1 of 6 stages.',
    );

    await surface.screenshot({ path: `${OUT}/01-strip.png` });

    // Depth 2: value, lift, typical and n together.
    const attention = visible(
      surface,
      '[data-test="stage-detail"][data-stage="attention"]',
    );
    const measureTrigger = byTest(attention, 'stage-measure-trigger');
    await expect(measureTrigger).toHaveAttribute('aria-expanded', 'false');
    await measureTrigger.focus();
    await page.keyboard.press('Enter');
    await expect(measureTrigger).toHaveAttribute('aria-expanded', 'true');

    const line = byTest(attention, 'stage-measure-line');
    await expect(line).toHaveText(
      /^0:10 average view duration · 0\.\dx typical · typical = 0:40 · n = 20$/,
    );

    // Depth 3: the provider field and the ingestion path.
    const rawTrigger = byTest(attention, 'stage-raw-trigger');
    await rawTrigger.click();
    await expect(rawTrigger).toHaveAttribute('aria-expanded', 'true');
    await expect(byTest(attention, 'stage-ingestion-path')).toContainText(
      'Ingestion path:',
    );
    await expect(byTest(attention, 'stage-peer')).toHaveCount(PEERS);

    await surface.screenshot({ path: `${OUT}/02-measure-raw.png` });

    // Genome: every recommendation beside its evidence, claims by strength.
    const findings = byTest(surface, 'genome-finding');
    await expect(findings.first()).toBeVisible();
    // Every recommendation, the folded ones included, so read from the list.
    const orphaned = await byTest(surface, 'genome-findings').evaluate(
      (list) =>
        [...list.querySelectorAll('[data-test="recommendation"]')].filter(
          (el) =>
            ![...(el.parentElement?.children ?? [])].some(
              (s) => s.getAttribute('data-test') === 'evidence',
            ),
        ).length,
    );
    expect(orphaned).toBe(0);

    const causal = visible(
      surface,
      '[data-test="genome-finding"][data-strength="causal"]',
    );
    await expect(causal).toHaveCount(1);
    await expect(byTest(causal, 'genome-claim')).toHaveText(
      /^Changing to result first: yes increased attention \(concluded Change log entry, \d{4}-\d{2}-\d{2}\)$/,
    );
    await expect(byTest(causal, 'genome-backing')).toHaveAttribute(
      'data-backing-kind',
      'change_log',
    );

    const readings = {
      states,
      measureLine: await line.textContent(),
      coverage: await byTest(surface, 'signal-coverage').textContent(),
      diagnosis: await byTest(surface, 'signal-diagnosis').textContent(),
      bars,
      claims: await byTest(surface, 'genome-finding').evaluateAll((els) =>
        els.map((el) => [
          el.getAttribute('data-strength'),
          el.querySelector('[data-test="genome-claim"]')?.textContent,
          el.querySelector('[data-test="evidence-label"]')?.textContent,
        ]),
      ),
    };
    console.log('SIGNAL_SURFACE_READINGS', JSON.stringify(readings, null, 2));

    await surface.screenshot({ path: `${OUT}/03-genome.png` });

    // A comparable is a link to that video's own signals.
    const peerLink = byTest(causal, 'comparable-link').first();
    const peerId = await peerLink.getAttribute('data-video-id');
    expect(peerIds).toContain(peerId);
    await peerLink.click();
    await expect(surface).toHaveAttribute('data-video-id', peerId!);
    await expect(byTest(surface, 'stage-strip')).toBeVisible();

    await surface.screenshot({ path: `${OUT}/04-comparable.png` });

    // At a phone width.
    await page.setViewportSize({ width: 390, height: 6000 });
    await surface.screenshot({ path: `${OUT}/05-narrow.png` });
  });
});
