import { expect, test } from '@playwright/test';

import { byTest } from '../utils/visible';
import { ReachPageObject } from './reach.po';

/**
 * The reach page's rules, with or without ClickHouse (cross-platform reach
 * design, approved 2026-09-28). The figures are in `reach-evidence.spec.ts`,
 * which seeds ClickHouse; these hold on any server.
 */
test.describe('Reach page: what is measured, and what is not', () => {
  test('a platform without unique reach says so, with its reason; nothing totals reach', async ({
    page,
  }) => {
    const reach = new ReachPageObject(page);
    const fixture = await reach.setup();

    await reach.open(fixture.team);

    const youtube = reach.channel(fixture.youtube.connectionId);
    await expect(youtube).toContainText('Not measured');
    await expect(byTest(youtube, 'channel-reach-reason')).toHaveText(
      /YouTube reports how many times your videos were viewed, not how many different people/,
    );

    // One card per channel, and no figure that adds them.
    await expect(page.getByText(/total accounts reached/i)).toHaveCount(0);
    await expect(reach.channel(fixture.instagram.connectionId)).toBeVisible();
  });

  test('90 days is not measured anywhere, and says why', async ({ page }) => {
    const reach = new ReachPageObject(page);
    const fixture = await reach.setup();

    await reach.open(fixture.team, { window: 90 });

    await expect(
      byTest(reach.channel(fixture.instagram.connectionId), 'channel-reach-reason'),
    ).toHaveText(/Meta's longest unique-reach window is 30 days/);
    await expect(byTest(page, 'reach-window-90')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('posts: YouTube new accounts are not measured; Instagram has a cell', async ({
    page,
  }) => {
    const reach = new ReachPageObject(page);
    const fixture = await reach.setup();

    await reach.open(fixture.team, { view: 'posts' });

    await expect(
      byTest(reach.postRow('Harbour long cut'), 'reach-post-new'),
    ).toHaveText('Not measured');
    await expect(
      byTest(reach.postRow('Harbour reel'), 'reach-post-new'),
    ).not.toHaveText('Not measured');
    expect(fixture.instagram.postId).toBeTruthy();
  });
});
