import AxeBuilder from '@axe-core/playwright';
import { Page, expect, test } from '@playwright/test';

import { SeededTeam, seedProject, seedTeamAccount } from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * FILM-DS-04. axe-core over the pages a person meets, on the production
 * build: WCAG 2.0 and 2.1 A and AA, which include colour contrast, ARIA
 * validity and names for controls, plus axe's best-practice rules for the page
 * structure (one main landmark, one h1, heading order).
 *
 * A violation fails the test with the rule, the impact and the elements, so
 * the failure is the to-do list. Nothing is excluded from a page to make it
 * pass; a rule is turned off only in `KNOWN_LIMITS`, with the reason.
 */

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const STRUCTURE = ['best-practice'];

/** Rules axe cannot judge here, with why. */
const KNOWN_LIMITS: string[] = [];

/**
 * Radix Tabs point `aria-controls` at a panel id and mount only the active
 * panel, so an inactive tab names an element that is not in the page. ARIA
 * allows that reference to be absent; axe reports it as critical anyway. Only
 * tabs are excused, and only from this one rule.
 */
const isRadixTab = (html: string) => /role="tab"/.test(html);

/** Animations finished: contrast read mid-fade is not the colour people see. */
async function animationsDone(page: Page) {
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => a.effect?.getTiming().iterations !== Infinity)
        .map((a) => a.finished.catch(() => undefined)),
    ),
  );
}

async function audit(page: Page, tags: string[]) {
  await animationsDone(page);

  const results = await new AxeBuilder({ page })
    .withTags(tags)
    .disableRules(KNOWN_LIMITS)
    .analyze();

  const violations = results.violations
    .map((v) =>
      v.id === 'aria-valid-attr-value'
        ? { ...v, nodes: v.nodes.filter((n) => !isRadixTab(n.html)) }
        : v,
    )
    .filter((v) => v.nodes.length > 0);

  return violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.help}\n` +
      v.nodes
        .slice(0, 5)
        .map((n) => `    ${n.target.join(' ')}`)
        .join('\n'),
  );
}

/** axe needs the page rendered; a heading of any level means the content is in. */
async function settled(page: Page) {
  await expect(page.getByRole('heading').first()).toBeVisible();
}

async function expectClean(page: Page) {
  await settled(page);

  expect(await audit(page, WCAG), 'WCAG A and AA').toEqual([]);
}

async function expectStructure(page: Page) {
  await settled(page);

  expect(await audit(page, STRUCTURE), 'page structure').toEqual([]);
}

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
  '/auth/password-reset',
];

test.describe('Accessibility: public pages', () => {
  for (const path of PUBLIC_PAGES) {
    test(`${path} has no WCAG A/AA violations`, async ({ page }) => {
      await page.goto(path);
      await expectClean(page);
    });

    test(`${path} has a sound page structure`, async ({ page }) => {
      await page.goto(path);
      await expectStructure(page);
    });
  }
});

test.describe('Accessibility: the studio', () => {
  let team: SeededTeam;
  let slug = '';
  let projectSlug = '';

  test.beforeAll(async () => {
    team = await seedTeamAccount({ emailPrefix: 'axe' });

    const project = await seedProject(team);

    slug = team.slug;
    projectSlug = project.slug;
  });

  const STUDIO_PAGES = [
    { name: 'the project list', path: () => `/home/${slug}/studio` },
    {
      name: 'the project overview',
      path: () => `/home/${slug}/studio/${projectSlug}`,
    },
    {
      name: 'episodes',
      path: () => `/home/${slug}/studio/${projectSlug}/episodes`,
    },
    {
      name: 'characters',
      path: () => `/home/${slug}/studio/${projectSlug}/assets?tab=character`,
    },
    {
      name: 'locations',
      path: () => `/home/${slug}/studio/${projectSlug}/assets?tab=location`,
    },
    {
      name: 'the audio library',
      path: () => `/home/${slug}/studio/${projectSlug}/audio-library`,
    },
    {
      name: 'narrative arcs',
      path: () => `/home/${slug}/studio/${projectSlug}/canon`,
    },
    {
      name: 'analytics',
      path: () => `/home/${slug}/studio/${projectSlug}/analytics`,
    },
    {
      name: 'platforms',
      path: () => `/home/${slug}/studio/${projectSlug}/platforms`,
    },
  ];

  for (const studioPage of STUDIO_PAGES) {
    test(`${studioPage.name} has no WCAG A/AA violations`, async ({ page }) => {
      await signInAs(page, team);
      await page.goto(studioPage.path());
      await expectClean(page);
    });

    test(`${studioPage.name} has a sound page structure`, async ({ page }) => {
      await signInAs(page, team);
      await page.goto(studioPage.path());
      await expectStructure(page);
    });
  }
});
