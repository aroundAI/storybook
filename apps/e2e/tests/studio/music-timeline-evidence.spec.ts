import { expect, test } from '@playwright/test';

import {
  insertRow,
  seedProject,
  seedTeamAccount,
  uniqueStamp,
} from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * FILM-514 PR screenshots: the Music timeline, the API keys list and the two
 * legal pages after the retired music vendors were removed. Skipped unless
 * CAPTURE_EVIDENCE is set, so CI pays nothing for it. The same spec run on
 * `main` gives the "before" set.
 */

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

const SERVICE_ROLE_KEY =
  process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const service = { key: SERVICE_ROLE_KEY };

test.describe('FILM-514 evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 to regenerate the PR screenshots.',
  );

  test('Music timeline, API keys and legal pages', async ({ page }) => {
    const team = await seedTeamAccount({ emailPrefix: 'film514ev' });
    const project = await seedProject(team);

    const episode = await insertRow<{ id: string; slug: string }>(
      'episodes',
      {
        project_id: project.id,
        number: 1,
        title: 'The Harbour',
        slug: `film514ev-${uniqueStamp().slice(0, 8)}`,
        // The Audio Studio stays locked until a scene has dialogue.
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
              dialogue: [{ character: 'Ava', text: 'The boats are late.' }],
            },
          ],
        },
      },
      service,
    );

    await insertRow(
      'audio_tracks',
      {
        episode_id: episode.id,
        type: 'music',
        name: 'Harbour theme at dusk',
        file_url: 'https://example.com/harbour-theme.mp3',
        duration_seconds: 30,
        timeline_start_seconds: 0,
        volume: 0.5,
        metadata: { prompt: 'Harbour theme', sceneNumber: 1 },
      },
      service,
    );

    await insertRow(
      'audio_cues',
      {
        episode_id: episode.id,
        scene_number: 1,
        cue_type: 'music',
        prompt: 'Low strings under the storm',
        start_offset_seconds: 40,
        duration_seconds: 20,
        status: 'pending',
      },
      service,
    );

    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${episode.slug}/audio-studio`,
    );
    await page.getByRole('button', { name: /^Music/ }).click();
    await expect(page.getByText('Harbour theme at dusk')).toBeVisible();
    await page.screenshot({ path: `${OUT}/01-music-timeline.png` });

    await page.getByText('Harbour theme at dusk').click();
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();
    await page.screenshot({ path: `${OUT}/02-finished-track-menu.png` });
    await page.mouse.click(5, 5);

    await page.getByText('Low strings under the storm').click();
    await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();
    await page.screenshot({ path: `${OUT}/03-cue-menu.png` });

    await page.goto(`/home/${team.slug}/settings`);
    const audioKeys = page.getByText('AI voice synthesis').first();
    await audioKeys.scrollIntoViewIfNeeded();
    await expect(audioKeys).toBeVisible();
    await page.screenshot({ path: `${OUT}/04-api-keys.png` });

    await page.goto('/privacy-policy');
    const music = page.getByText('Music Generation', { exact: true });
    await music.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/05-privacy-processors.png` });

    await page.goto('/terms-of-service');
    const audio = page.getByText('Audio Production', { exact: true });
    await audio.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${OUT}/06-terms-audio.png` });
  });
});
