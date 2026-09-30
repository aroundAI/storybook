import { expect, test } from '@playwright/test';

import { readRows } from '../utils/seed';
import { byTest } from '../utils/visible';
import { type CanonFixture, openStoryCanon, seedCanon } from './canon-fixture';

/**
 * FILM-1007 / FILM-1005: the canon panel edits and deletes through the
 * actions that already exist, and each change lands in state_deltas.
 *
 * Immutable events offer delete only -- an event is corrected by deleting it
 * and adding the right one. Threads change status and take payoffs; a thread
 * is never deleted. A character state is never overwritten: the dialog
 * appends the next one.
 */

let canon: CanonFixture;

test.beforeAll(async () => {
  canon = await seedCanon('canon-edit');
});

test.describe('Canon edit and delete (FILM-1007)', () => {
  test.describe.configure({ mode: 'serial' });

  test('a thread is resolved with a payoff, and the change is audited', async ({
    page,
  }) => {
    await openStoryCanon(page, canon);
    await byTest(page, 'canon-threads-tab').click();

    await expect(byTest(page, 'canon-thread')).toHaveCount(1);
    await byTest(page, 'canon-thread-edit').click();

    await byTest(page, 'canon-thread-status').click();
    await page.getByRole('option', { name: 'Resolved' }).click();
    await byTest(page, 'canon-thread-payoffs').fill('The key was in the lamp');
    await byTest(page, 'canon-thread-edit-submit').click();

    await expect(page.getByText('Thread updated').first()).toBeVisible();
    // The list holds open and progressed threads only.
    await expect(byTest(page, 'canon-thread')).toHaveCount(0);

    const [thread] = await readRows<{
      status: string;
      payoffs: string[];
      version: number;
    }>(
      'narrative_threads',
      `id=eq.${canon.threadId}&select=status,payoffs,version`,
    );
    expect(thread).toMatchObject({
      status: 'resolved',
      payoffs: ['The key was in the lamp'],
    });

    const deltas = await readRows<{
      entity_type: string;
      change_reason: string;
    }>(
      'state_deltas',
      `entity_id=eq.${canon.threadId}&select=entity_type,change_reason`,
    );
    expect(deltas).toEqual([
      {
        entity_type: 'thread',
        change_reason: 'Thread status open -> resolved',
      },
    ]);
  });

  test('a character gets a next state, twice, and the first stays', async ({
    page,
  }) => {
    await openStoryCanon(page, canon);
    await byTest(page, 'canon-characters-tab').click();

    for (const [state, trigger] of [
      ['grieving', 'Ilya is found'],
      ['resolute', 'She reads the map'],
    ] as const) {
      await byTest(page, 'canon-character-state-edit').first().click();
      await byTest(page, 'canon-character-state-value').fill(state);
      await byTest(page, 'canon-character-state-trigger').fill(trigger);
      await byTest(page, 'canon-character-state-submit').click();
      await expect(
        page.getByText('Character state recorded').first(),
      ).toBeVisible();
      // The second pass is where a form that kept the first text would show.
      await expect(byTest(page, 'canon-character-state-value')).toHaveCount(0);
    }

    const states = await readRows<{ state_value: { state: string } }>(
      'character_states',
      `character_id=eq.${canon.characterId}&select=state_value&order=created_at`,
    );
    expect(states.map((s) => s.state_value.state)).toEqual([
      'calm',
      'grieving',
      'resolute',
    ]);
  });

  test('an event is deleted after confirming, and the deletion is audited', async ({
    page,
  }) => {
    await openStoryCanon(page, canon);

    await expect(byTest(page, 'canon-event')).toHaveCount(1);
    await byTest(page, 'canon-event-delete').click();

    // Cancelling changes nothing.
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(byTest(page, 'canon-event')).toHaveCount(1);

    await byTest(page, 'canon-event-delete').click();
    await byTest(page, 'canon-event-delete-confirm').click();

    await expect(page.getByText('Event deleted').first()).toBeVisible();
    await expect(byTest(page, 'canon-event')).toHaveCount(0);

    expect(
      await readRows('immutable_events', `id=eq.${canon.eventId}&select=id`),
    ).toEqual([]);

    const deltas = await readRows<{
      entity_type: string;
      before_state: unknown;
    }>(
      'state_deltas',
      `entity_id=eq.${canon.eventId}&select=entity_type,before_state`,
    );
    expect(deltas).toEqual([
      {
        entity_type: 'immutable',
        before_state: expect.objectContaining({
          eventKey: 'character:ilya:dead',
        }),
      },
    ]);
  });
});
