import { expect, test } from '@playwright/test';

import {
  insertRow,
  seedProject,
  seedTeamAccount,
  uniqueStamp,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * FILM-505: the Audio Studio dialogue timeline is operable from the keyboard.
 * Blocks are role=button with an aria-label, arrows move between them, Enter
 * opens the actions menu, Escape closes it and returns focus to the block.
 */

const SERVICE_ROLE_KEY =
  process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const service = { key: SERVICE_ROLE_KEY };

async function seedDialogueEpisode() {
  const team = await seedTeamAccount({ emailPrefix: 'film505' });
  const project = await seedProject(team);

  const episode = await insertRow<{ id: string; slug: string }>(
    'episodes',
    {
      project_id: project.id,
      number: 1,
      title: 'The Harbour',
      slug: `film505-${uniqueStamp().slice(0, 8)}`,
      screenplay_data: {
        title: 'The Harbour',
        scenes: [
          {
            number: 1,
            heading: 'EXT. HARBOUR - DUSK',
            location: 'Harbour',
            timeOfDay: 'dusk',
            description: 'Boats come in.',
            estimatedDuration: 30,
            dialogue: [
              { character: 'Ava', text: 'The boats are late.' },
              { character: 'Ben', text: 'The tide is against us.' },
            ],
          },
        ],
      },
    },
    service,
  );

  const ava = await insertRow<{ id: string }>(
    'assets',
    { project_id: project.id, type: 'character', name: 'Ava' },
    service,
  );
  const ben = await insertRow<{ id: string }>(
    'assets',
    { project_id: project.id, type: 'character', name: 'Ben' },
    service,
  );

  await insertRow(
    'dialogue_lines',
    {
      episode_id: episode.id,
      character_asset_id: ava.id,
      text: 'The boats are late.',
      sequence_number: 1,
    },
    service,
  );
  await insertRow(
    'dialogue_lines',
    {
      episode_id: episode.id,
      character_asset_id: ben.id,
      text: 'The tide is against us.',
      sequence_number: 2,
    },
    service,
  );

  return { team, project, episode };
}

test.describe('FILM-505: dialogue timeline keyboard operation', () => {
  test('arrows move focus, Enter opens the menu, Escape returns focus', async ({
    page,
  }) => {
    const { team, project, episode } = await seedDialogueEpisode();

    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${episode.slug}/audio-studio`,
    );

    const first = byTest(page, 'dialogue-block-0');
    const second = byTest(page, 'dialogue-block-1');

    await expect(first).toHaveAttribute('role', 'button');
    await expect(first).toHaveAttribute(
      'aria-label',
      /Ava: The boats are late/,
    );

    await first.focus();
    await page.keyboard.press('ArrowDown');
    await expect(second).toBeFocused();

    await page.keyboard.press('ArrowUp');
    await expect(first).toBeFocused();

    await page.keyboard.press('Enter');
    const menu = page.getByRole('menu', { name: 'Dialogue line actions' });
    await expect(menu).toBeVisible();
    await expect(first).toHaveAttribute('aria-pressed', 'true');

    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(first).toBeFocused();
  });

  test('typing e in the edit textarea does not trigger shortcuts', async ({
    page,
  }) => {
    const { team, project, episode } = await seedDialogueEpisode();

    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${episode.slug}/audio-studio`,
    );

    await byTest(page, 'dialogue-block-0').focus();
    await page.keyboard.press('e');

    const textarea = page.getByRole('dialog', { name: 'Edit dialogue' });
    await expect(textarea).toBeVisible();
    await page.keyboard.type('end');
    await expect(textarea.locator('textarea')).toContainText('end');
  });
});
