import { expect, test } from '@playwright/test';

import { seedProject, seedTeamAccount } from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * Screenshots and measurements for the accessibility fixes.
 *
 * Not a guard: `axe.spec.ts` and `sidebar-active.spec.ts` hold those. This
 * produces what a reviewer can look at, for the things a person sees change:
 * the sidebar marking the current page, the darker project status badge, and
 * the grey secondary text. Skipped unless CAPTURE_EVIDENCE is set.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

test.describe('Accessibility fixes: evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 to regenerate the PR screenshots.',
  );

  test('captures the sidebar, the status badge and the secondary text', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'a11y-evidence' });
    const project = await seedProject(team);
    const base = `/home/${team.slug}/studio`;

    await signInAs(page, team);

    // 1. The project list: the status badge is now dark enough for its text.
    await page.goto(base);
    await expect(page.getByRole('heading').first()).toBeVisible();
    await page.screenshot({ path: `${OUT}/01-project-list.png` });

    const badge = page.getByText('active', { exact: true }).first();
    const badgeColours = await badge.evaluate((el) => {
      const style = getComputedStyle(el);

      return { color: style.color, background: style.backgroundColor };
    });

    console.log('status badge', JSON.stringify(badgeColours));

    // 2. The sidebar with Locations in view, then Characters: the lit link moves.
    await page.goto(`${base}/${project.slug}/assets?tab=location`);
    await expect(byTest(page, 'studio-nav-locations')).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.screenshot({ path: `${OUT}/02-sidebar-locations-lit.png` });

    await page.goto(`${base}/${project.slug}/assets?tab=character`);
    await expect(byTest(page, 'studio-nav-characters')).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.screenshot({ path: `${OUT}/03-sidebar-characters-lit.png` });

    // 3. A narrow window: the legal page's table scrolls inside itself.
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/cookie-policy');
    await expect(page.getByRole('heading').first()).toBeVisible();
    await page.screenshot({ path: `${OUT}/04-cookie-policy-375px.png` });
  });
});
