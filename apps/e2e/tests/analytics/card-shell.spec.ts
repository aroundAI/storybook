import { Page, expect, test } from '@playwright/test';

import { DeepDivePageObject } from '../deep-dive/deep-dive.po';
import { daysAgo } from '../revenue/revenue-currency.po';
import {
  seedProject,
  seedPublishedEpisode,
  seedRevenueRecord,
  seedSeason,
  seedTeamAccount,
  seedYouTubeConnection,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { OverviewPageObject } from './overview.po';

/**
 * FILM-1706 — the analytics card shell, in the browser.
 *
 * What a unit test cannot see: colours as the theme actually resolves them,
 * a disclosure driven by the keyboard, text that stays findable while
 * closed, and a figure's rendered width. None of it needs ClickHouse, so it
 * runs wherever the suite runs: the Overview's revenue comes from Postgres,
 * and every other card renders its claim either way.
 */
const cards = (page: Page) => page.locator('section[aria-labelledby]:visible');

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((value) => localStorage.setItem('theme', value), theme);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(
    theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/,
  );
}

/**
 * Cards whose computed background or border is not the design system's
 * `bg-card` / `border-border`, resolved by a probe element under the same
 * theme — so the comparison is colour to colour, not class to class.
 */
async function offTokenCards(page: Page) {
  await expect(cards(page).first()).toBeVisible();

  return page.evaluate(() => {
    const probe = document.createElement('div');

    probe.className = 'bg-card border border-border';
    document.body.appendChild(probe);

    const expected = getComputedStyle(probe);
    const want = {
      background: expected.backgroundColor,
      border: expected.borderTopColor,
    };

    const off = [
      ...document.querySelectorAll<HTMLElement>('section[aria-labelledby]'),
    ]
      .filter((card) => card.offsetParent !== null)
      .filter((card) => {
        const style = getComputedStyle(card);

        return (
          style.backgroundColor !== want.background ||
          style.borderTopColor !== want.border
        );
      })
      .map((card) => card.querySelector('h3')?.textContent ?? '?');

    probe.remove();

    return { off, background: want.background };
  });
}

test.describe('Analytics card shell (FILM-1706)', () => {
  test('every card paints with the design system, in light and in dark', async ({
    page,
  }) => {
    const overview = new OverviewPageObject(page);
    const fixture = await overview.setup('two');
    const deepDive = new DeepDivePageObject(page);
    const backgrounds: string[] = [];

    for (const theme of ['light', 'dark'] as const) {
      await overview.goToOverview(fixture);
      await setTheme(page, theme);

      const onOverview = await offTokenCards(page);

      expect(onOverview.off, `Overview, ${theme}`).toEqual([]);
      backgrounds.push(onOverview.background);

      await deepDive.goToDeepDive(fixture.team.slug, fixture.project.slug);

      expect((await offTokenCards(page)).off, `Deep Dive, ${theme}`).toEqual(
        [],
      );
    }

    // Otherwise "equal to the token" could be two themes resolving the same.
    expect(backgrounds[1]).not.toBe(backgrounds[0]);
  });

  test('details open from the keyboard, say so, and close again', async ({
    page,
  }) => {
    const overview = new OverviewPageObject(page);

    await overview.goToOverview(await overview.setup('none'));

    const shares = page.locator('[data-test="overview-shares"]');
    const trigger = shares.getByRole('button', { name: 'Details' });
    const region = shares.getByRole('region', { includeHidden: true });

    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(region).toBeHidden();

    await trigger.focus();
    await page.keyboard.press('Enter');

    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(region).toBeVisible();
    await expect(region).toContainText(
      'We don’t collect how content was shared, only how often.',
    );

    await page.keyboard.press(' ');

    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(region).toBeHidden();
  });

  test('closed details stay in the page, findable, and open when found', async ({
    page,
  }) => {
    const overview = new OverviewPageObject(page);

    await overview.goToOverview(await overview.setup('two'));

    // Every caveat and footnote these cards carried on the front before
    // FILM-1706, now behind "Details": still in the DOM, so find-in-page
    // and copy reach them.
    const moved = [
      ['overview-shares', 'We don’t collect how content was shared'],
      [
        'overview-revenue',
        'Channel-level income is on the account’s Revenue tab.',
      ],
    ] as const;

    for (const [card, text] of moved) {
      const region = page
        .locator(`[data-test="${card}"]`)
        .first()
        .getByRole('region', { includeHidden: true });

      await expect(region).toHaveAttribute('hidden', 'until-found');
      await expect(region).toContainText(text);
    }

    // What browser find does on a match inside `hidden="until-found"`.
    const shares = page.locator('[data-test="overview-shares"]');
    const region = shares.getByRole('region', { includeHidden: true });

    await region.dispatchEvent('beforematch');

    await expect(
      shares.getByRole('button', { name: 'Details' }),
    ).toHaveAttribute('aria-expanded', 'true');
    await expect(region).toBeVisible();
  });

  test('a card with details is marked before it is clicked, and only then', async ({
    page,
  }) => {
    const overview = new OverviewPageObject(page);

    await overview.goToOverview(await overview.setup('two'));
    await expect(cards(page).first()).toBeVisible();

    const marks = await cards(page).evaluateAll((all) =>
      all.map((card) => ({
        title: card.querySelector('h3')?.textContent,
        trigger: card.querySelector('button[aria-controls]') !== null,
        hover: card.className.includes('hover:bg-accent'),
      })),
    );

    expect(marks.filter(({ trigger, hover }) => trigger !== hover)).toEqual([]);
    expect(marks.some(({ trigger }) => trigger)).toBe(true);
  });

  test('a figure keeps its width when its digits change', async ({
    browser,
    baseURL,
  }) => {
    // Same digit count, narrowest and widest digit: with proportional
    // figures "1,111" is visibly narrower than "8,888", and a refetch that
    // moves between them shifts everything beside it.
    const widths: number[] = [];

    for (const cents of [111_100, 888_800]) {
      const team = await seedTeamAccount();
      const project = await seedProject(team);
      const connectionId = await seedYouTubeConnection(team.accountId);
      const { seasonId } = await seedSeason(project.id);
      const { publishId } = await seedPublishedEpisode(
        project.id,
        connectionId,
        { title: 'Width', seasonId },
      );

      await seedRevenueRecord({
        publishId,
        revenueCents: cents,
        recordDate: daysAgo(5),
        category: 'ads',
      });
      // A fresh context each time: the second sign-in would otherwise land
      // on an already signed-in session with no form to fill.
      const context = await browser.newContext({ baseURL });
      const page = await context.newPage();

      await signInAs(page, team);
      await new OverviewPageObject(page).goToOverview({
        team,
        project,
        connectionId,
        publishId,
      });

      const figure = page
        .locator('[data-test="overview-revenue"]')
        .locator('[data-test="card-figure"]');

      await expect(figure).toHaveText(cents === 111_100 ? '$1,111' : '$8,888');
      await expect(figure).toHaveCSS('font-variant-numeric', 'tabular-nums');

      widths.push(
        await figure.evaluate((el) => {
          const range = document.createRange();

          range.selectNodeContents(el);

          return range.getBoundingClientRect().width;
        }),
      );

      await context.close();
    }

    expect(Math.abs(widths[0]! - widths[1]!)).toBeLessThan(0.5);
  });
});
