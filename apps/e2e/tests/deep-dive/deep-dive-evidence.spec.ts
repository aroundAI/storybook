import { expect, test } from '@playwright/test';

import { RevenuePageObject } from '../revenue/revenue.po';
import { seedPublishedEpisode, seedYouTubeConnection } from '../utils/seed';
import { DeepDivePageObject } from './deep-dive.po';

/**
 * Screenshots and DOM measurements for FILM-1611.
 *
 * Not a guard — `deep-dive.spec.ts`, `tag-medians.spec.ts` and
 * `revenue.spec.ts` hold those. This produces what a reviewer looks at, and
 * reads the claims out of the DOM rather than trusting the images. ClickHouse
 * is off locally and in CI, so every card shows its empty or zero state; the
 * screenshots show the wiring, not real figures.
 *
 * Skipped unless CAPTURE_EVIDENCE is set, so CI pays nothing for it.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

test.describe('FILM-1611 — evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 to regenerate the PR screenshots.',
  );

  test('captures the Deep Dive filter, YPP cards, tag medians and revenue mix', async ({
    page,
  }) => {
    const deepDive = new DeepDivePageObject(page);
    const fixture = await deepDive.setup();

    const secondChannelId = await seedYouTubeConnection(
      fixture.team.accountId,
      'Second Channel',
    );

    await seedPublishedEpisode(fixture.project.id, secondChannelId, {
      number: 3,
    });
    await page.reload();
    await page.locator('[data-test="analytics-tab-deep-dive"]').click();
    await expect(deepDive.yppCards()).toHaveCount(2);

    // 1. The tab as it opens: All channels, and one YPP card per active
    //    YouTube channel.
    await page.screenshot({
      path: `${OUT}/01-all-channels.png`,
      fullPage: true,
    });

    const yppSection = page.locator('[data-test="ypp-progress-list"]:visible');

    await yppSection.scrollIntoViewIfNeeded();
    await yppSection.screenshot({ path: `${OUT}/01b-ypp-cards.png` });

    // 2. The selector open, the disconnected channel listed and marked.
    await deepDive.channelFilter().click();
    await expect(
      page.locator('[data-test="channel-filter-inactive-badge"]'),
    ).toBeVisible();
    // Animations off: the popover fades in, and a mid-fade capture shows the
    // page underneath through it.
    await page.screenshot({
      path: `${OUT}/02-selector-open.png`,
      animations: 'disabled',
    });

    const options = await page
      .locator('[data-test^="channel-filter-option-"]')
      .allTextContents();

    await page.keyboard.press('Escape');

    // 3. One channel selected: its YPP card alone.
    await deepDive.chooseChannel(fixture.activeChannelId);
    await expect(deepDive.yppCards()).toHaveCount(1);
    // The app scrolls inside its own container, so a full-page capture is
    // only the viewport; the YPP card is what changed, so it is captured.
    await expect(
      page.getByText('Not enough published videos yet to compute a median.'),
    ).toBeVisible();

    const yppCard = page
      .locator('[data-test="deep-dive-tab"]:visible')
      .getByText('YouTube Partner Programme')
      .locator('xpath=ancestor::div[contains(@class, "rounded-2xl")][1]');

    await yppCard.scrollIntoViewIfNeeded();
    await yppCard.screenshot({ path: `${OUT}/03-active-channel-ypp.png` });

    const selectedLabel = await deepDive.channelFilter().textContent();
    const yppCardsForChannel = await deepDive.yppCards().count();

    // 4. The disconnected channel selected: the YPP section says why it is
    //    empty instead of erroring.
    await deepDive.chooseChannel(fixture.inactiveChannelId);

    const notApplicable = page.locator(
      '[data-test="ypp-not-applicable"]:visible',
    );

    await expect(notApplicable).toBeVisible();
    await expect(
      page.getByText('Not enough published videos yet to compute a median.'),
    ).toBeVisible();

    await yppCard.scrollIntoViewIfNeeded();
    await yppCard.screenshot({ path: `${OUT}/04-inactive-channel-ypp.png` });

    const inactiveSelectionNote = await notApplicable.textContent();
    const yppCardsForInactive = await deepDive.yppCards().count();

    // 5-6. Tag medians on the tags page: Topic, then Language.
    await page.goto(`/home/${fixture.team.slug}/studio/analytics/tags`);

    const medians = page.locator('[data-test="tag-medians-card"]:visible');
    const dimension = medians.locator(
      '[data-test="tag-medians-dimension-trigger"]',
    );

    await expect(dimension).toHaveText('Topic');
    await medians.screenshot({ path: `${OUT}/05-tag-medians-topic.png` });

    await dimension.click();
    await page.locator('[data-test="tag-medians-dimension-language"]').click();
    await expect(dimension).toHaveText('Language');
    await medians.screenshot({ path: `${OUT}/06-tag-medians-language.png` });

    const languageEmpty = await medians
      .locator('[data-test="tag-medians-empty"]')
      .textContent();

    // 7. The revenue mix, after a licensing entry.
    const revenue = new RevenuePageObject(page);

    await revenue.goToRevenue(fixture.team.slug);
    await revenue.addEntry({ dollars: '250.00', category: 'Licensing' });
    await revenue.expectSuccessToast();

    await page.goto(`/home/${fixture.team.slug}/studio/analytics`);
    await page.locator('[data-test="revenue-tab-overview"]').click();

    const mix = page.locator('[data-test="revenue-mix-card"]:visible');

    await expect(mix).toContainText('Licensing');
    await mix.screenshot({ path: `${OUT}/07-revenue-mix.png` });

    console.log(
      'MEASURED',
      JSON.stringify(
        {
          selectorOptions: options,
          selectedLabel,
          yppCardsForSelectedChannel: yppCardsForChannel,
          inactiveSelectionNote,
          yppCardsForInactiveSelection: yppCardsForInactive,
          languageEmptyCopy: languageEmpty,
          revenueMixText: await mix.textContent(),
        },
        null,
        2,
      ),
    );
  });
});
