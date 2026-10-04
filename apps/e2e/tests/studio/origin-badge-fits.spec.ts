import { expect, test } from '@playwright/test';

import {
  insertRow,
  seedProject,
  seedTeamAccount,
  serviceRoleAuth,
  uniqueStamp,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * FILM-1910: the origin badge on a shot card stays inside the card. "Claude
 * via MCP · reported: <model>" is wider than a narrow card's caption row and
 * was clipped by the card's overflow.
 */
const WIDTHS = [1280, 1024, 768, 390];

test.describe('origin badge on a shot card', () => {
  test('fits inside its card at every width', async ({ page }) => {
    test.setTimeout(180_000);
    page.setDefaultNavigationTimeout(90_000);

    const team = await seedTeamAccount({ emailPrefix: 'badge' });
    const project = await seedProject(team);
    const slug = `badge-${uniqueStamp().slice(0, 8)}`;
    const auth = serviceRoleAuth();
    const episode = await insertRow<{ id: string }>(
      'episodes',
      { project_id: project.id, number: 1, title: 'Badges', slug },
      auth,
    );
    const at = new Date().toISOString();
    const origins = [
      { kind: 'server', model: 'gemini-2.5-pro', at },
      {
        kind: 'external',
        model: 'claude-opus-5-5',
        clientName: 'Claude',
        at,
      },
      { kind: 'human', at },
    ];

    for (const [index, origin] of origins.entries()) {
      await insertRow(
        'shots',
        {
          episode_id: episode.id,
          sequence_number: index + 1,
          prompt: 'A long description of what happens in this shot',
          generation_origin: origin,
        },
        auth,
      );
    }

    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/visual-studio`,
    );

    const cards = byTest(page, 'shot-card');
    await expect(cards).toHaveCount(3, { timeout: 60_000 });

    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });

      for (const index of [0, 1, 2]) {
        const card = cards.nth(index);
        const badge = byTest(card, 'origin-badge');

        await expect(badge).toBeVisible();

        const cardBox = (await card.boundingBox())!;
        const badgeBox = (await badge.boundingBox())!;

        expect(
          badgeBox.x,
          `badge ${index} left edge at ${width}px`,
        ).toBeGreaterThanOrEqual(cardBox.x);
        expect(
          badgeBox.x + badgeBox.width,
          `badge ${index} right edge at ${width}px`,
        ).toBeLessThanOrEqual(cardBox.x + cardBox.width);
      }
    }
  });
});
