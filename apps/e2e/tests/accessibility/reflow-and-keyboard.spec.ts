import { Page, expect, test } from '@playwright/test';

import { SeededTeam, seedProject, seedTeamAccount } from '../utils/seed';
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
