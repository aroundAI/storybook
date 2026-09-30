import { Locator, Page, expect, test } from '@playwright/test';

import {
  SeededTeam,
  seedEpisodeWorkspace,
  seedProject,
  seedTeamAccount,
} from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * FILM-DS-04 and FILM-DS-05. Two things a person does that axe cannot: make
 * the page narrow (a phone, or a desktop at 200% zoom, which is a 640px-wide
 * viewport) and use only the keyboard.
 */

/** 320px is a small phone; 640px is a 1280px window at 200% zoom (WCAG 1.4.4). */
const WIDTHS = [320, 640, 1024];

const PUBLIC_PAGES = [
  '/',
  '/faq',
  '/contact',
  '/privacy-policy',
  '/terms-of-service',
  '/cookie-policy',
  '/data-deletion',
  '/auth/sign-in',
  '/auth/sign-up',
];

async function overflow(page: Page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
}

async function expectNoHorizontalScroll(page: Page) {
  await expect(page.getByRole('heading').first()).toBeVisible();
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );

  const { scrollWidth, innerWidth } = await overflow(page);

  expect(
    scrollWidth,
    `the page is ${scrollWidth}px wide in a ${innerWidth}px window`,
  ).toBeLessThanOrEqual(innerWidth);
}

test.describe('Reflow: no horizontal scroll when narrow', () => {
  for (const width of WIDTHS) {
    for (const path of PUBLIC_PAGES) {
      test(`${path} at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(path);
        await expectNoHorizontalScroll(page);
      });
    }
  }

  test.describe('the studio', () => {
    let team: SeededTeam;
    let projectPath = '';

    test.beforeAll(async () => {
      team = await seedTeamAccount({ emailPrefix: 'reflow' });

      const project = await seedProject(team);

      projectPath = `/home/${team.slug}/studio/${project.slug}`;
    });

    const STUDIO = [
      { name: 'the project list', path: () => `/home/${team.slug}/studio` },
      { name: 'the overview', path: () => projectPath },
      { name: 'episodes', path: () => `${projectPath}/episodes` },
      { name: 'characters', path: () => `${projectPath}/assets?tab=character` },
      { name: 'analytics', path: () => `${projectPath}/analytics` },
    ];

    for (const width of WIDTHS) {
      for (const studio of STUDIO) {
        test(`${studio.name} at ${width}px`, async ({ page }) => {
          await page.setViewportSize({ width, height: 900 });
          await signInAs(page, team);
          await page.goto(studio.path());
          await expectNoHorizontalScroll(page);
        });
      }
    }
  });
});

test.describe('Keyboard only', () => {
  test('signs in with the keyboard alone, in reading order', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'keyboard' });

    await page.goto('/auth/sign-in');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const email = page.locator('input[name="email"]');
    const password = page.locator('input[name="password"]');

    // Focus lands on the email field first, then the password, then a submit
    // control: the order they read in.
    await email.focus();
    await expect(email).toBeFocused();
    await page.keyboard.type(team.email);

    await page.keyboard.press('Tab');
    await expect(password).toBeFocused();
    await page.keyboard.type(team.password);

    await page.keyboard.press('Enter');

    await page.waitForURL(/\/home\//);
  });

  test('every control in the studio sidebar can be reached and shows focus', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'keyboard' });
    const project = await seedProject(team);

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/${project.slug}`);

    const links = page.locator('[data-test^="studio-nav-"]:visible');
    await expect(links.first()).toBeVisible();

    const count = await links.count();

    expect(count).toBeGreaterThan(5);

    for (let n = 0; n < count; n += 1) {
      const link = links.nth(n);

      await link.focus();
      await expect(link).toBeFocused();

      // A focused link is visibly focused: a ring or an outline, not nothing.
      const ring = await link.evaluate((el) => {
        const style = getComputedStyle(el);

        return {
          outline:
            style.outlineStyle !== 'none' && style.outlineWidth !== '0px',
          shadow: style.boxShadow !== 'none',
        };
      });

      expect(
        ring.outline || ring.shadow,
        `${await link.textContent()} shows no focus indicator`,
      ).toBe(true);
    }
  });
});

/** Presses Tab until `target` has focus; fails if it is not reached in `limit` presses. */
async function tabTo(page: Page, target: Locator, limit = 40) {
  for (let presses = 1; presses <= limit; presses += 1) {
    await page.keyboard.press('Tab');

    if (await target.evaluate((el) => el === document.activeElement)) {
      return presses;
    }
  }

  throw new Error(`Tab did not reach the target in ${limit} presses`);
}

/** The controls, in the order Tab must reach them. */
async function expectFocusOrder(page: Page, controls: Locator[]) {
  for (const control of controls) {
    await tabTo(page, control);
    await expect(control).toBeFocused();
  }
}

test.describe('Keyboard only: skip links (FILM-DS-04)', () => {
  test('the sign-in page skips to its main landmark', async ({ page }) => {
    await page.goto('/auth/sign-in');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const skip = page.locator('[data-test="skip-to-content"]');

    await page.keyboard.press('Tab');
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();

    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/#main-content$/);
    await expect(page.locator('main#main-content')).toBeFocused();

    // The next Tab lands inside the content, not back in the navigation.
    await page.keyboard.press('Tab');
    await expect(
      page.locator('main#main-content').locator(':focus'),
    ).toHaveCount(1);
  });

  test('the studio skips past the sidebar', async ({ page }) => {
    const team = await seedTeamAccount({ emailPrefix: 'keyboard-skip' });
    const project = await seedProject(team);

    await signInAs(page, team);
    await page.goto(`/home/${team.slug}/studio/${project.slug}`);

    const skip = page.locator('[data-test="skip-to-content"]');

    await expect(page.locator('main#main-content')).toBeVisible();

    await page.keyboard.press('Tab');
    await expect(skip).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.locator('main#main-content')).toBeFocused();
  });
});

test.describe('Keyboard only: an episode (FILM-DS-04)', () => {
  let team: SeededTeam;
  let projectPath = '';
  let episodePath = '';

  test.beforeAll(async () => {
    team = await seedTeamAccount({ emailPrefix: 'keyboard-episode' });

    const project = await seedProject(team);
    const { slug } = await seedEpisodeWorkspace(project.id);

    projectPath = `/home/${team.slug}/studio/${project.slug}`;
    episodePath = `${projectPath}/episodes/${slug}`;
  });

  test('the episode tabs are reached in order and open with Enter', async ({
    page,
  }) => {
    await signInAs(page, team);
    await page.goto(`${episodePath}/ideation`);

    const ids = ['ideation', 'story', 'screenplay', 'shot-list', 'audio'];
    const tabs = ids.map((id) =>
      page.locator(`[data-test="episode-tab-${id}"]:visible`),
    );

    await expect(tabs[0]!).toBeVisible();
    await tabs[0]!.focus();
    await expectFocusOrder(page, tabs.slice(1));

    const story = tabs[1]!;

    await story.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/story$/);
  });

  test('the publish hub can be walked by keyboard without a trap', async ({
    page,
  }) => {
    await signInAs(page, team);
    await page.goto(`${episodePath}/publish`);
    await expect(page.getByRole('heading').first()).toBeVisible();

    const stops: string[] = [];

    for (let press = 0; press < 30; press += 1) {
      await page.keyboard.press('Tab');

      const stop = await page.evaluate(() => {
        const el = document.activeElement;

        if (!el || el === document.body) return null;

        const style = getComputedStyle(el);

        return {
          id: `${el.tagName}:${el.getAttribute('data-test') ?? el.textContent?.trim().slice(0, 30) ?? ''}`,
          indicator:
            (style.outlineStyle !== 'none' && style.outlineWidth !== '0px') ||
            style.boxShadow !== 'none',
        };
      });

      if (!stop) break;

      expect(stop.indicator, `${stop.id} shows no focus indicator`).toBe(true);
      stops.push(stop.id);
    }

    // Focus moved through several controls, and never sat on one (a trap).
    expect(new Set(stops).size).toBeGreaterThan(3);
    expect(stops.slice(-1)).not.toEqual(stops.slice(-2, -1));
  });

  test('the create-episode dialog takes focus, keeps it, and gives it back', async ({
    page,
  }) => {
    await signInAs(page, team);
    await page.goto(`${projectPath}/episodes`);

    const trigger = page
      .getByRole('button', { name: 'Create Episode' })
      .first();

    await expect(trigger).toBeVisible();
    await trigger.focus();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog');

    await expect(dialog).toBeVisible();

    // Focus is inside the dialog, and the form reads title, description,
    // then Cancel and Create.
    const title = dialog.getByLabel('Title');
    const description = dialog.getByLabel('Description (Optional)');
    const cancel = dialog.getByRole('button', { name: 'Cancel' });
    const create = dialog.getByRole('button', { name: 'Create Episode' });

    await title.focus();
    await expectFocusOrder(page, [description, cancel, create]);

    // Tab does not leave the dialog.
    for (let press = 0; press < 6; press += 1) {
      await page.keyboard.press('Tab');
      expect(
        await dialog.evaluate((el) => el.contains(document.activeElement)),
      ).toBe(true);
    }

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
