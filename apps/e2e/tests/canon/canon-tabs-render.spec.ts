import { expect, test } from '@playwright/test';

import { byTest } from '../utils/visible';
import { type CanonFixture, openStoryCanon, seedCanon } from './canon-fixture';

/**
 * FILM-1007: the Events, Threads and Characters tabs show what the project's
 * canon holds, with the fields a writer reads to decide what to change.
 */

let canon: CanonFixture;

test.beforeAll(async () => {
  canon = await seedCanon('canon-render');
});

test.describe('Canon tabs render the canon (FILM-1007)', () => {
  test('Events shows the description, the key and the episode', async ({
    page,
  }) => {
    await openStoryCanon(page, canon);

    const card = byTest(page, 'canon-event');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText(
      'Ilya died in the flood of the lower harbour.',
    );
    await expect(card).toContainText('character:ilya:dead');
    await expect(card).toContainText('Ep.1');
    await expect(byTest(page, 'canon-event-delete')).toBeVisible();
  });

  test('Threads shows the name, the description and the status', async ({
    page,
  }) => {
    await openStoryCanon(page, canon);
    await byTest(page, 'canon-threads-tab').click();

    const card = byTest(page, 'canon-thread');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('The missing key');
    await expect(card).toContainText('Someone took the key before the flood.');
    await expect(card).toContainText('open');
  });

  test('Characters shows the name, the state type and a way to record the next state', async ({
    page,
  }) => {
    await openStoryCanon(page, canon);
    await byTest(page, 'canon-characters-tab').click();

    await expect(page.getByText('Mara').first()).toBeVisible();
    await expect(page.getByText('Emotional').first()).toBeVisible();
    await expect(byTest(page, 'canon-character-state-edit')).toBeVisible();
    await expect(byTest(page, 'canon-character-history-toggle')).toBeVisible();
  });
});
