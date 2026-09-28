import { Page, expect, test } from '@playwright/test';

import {
  SeededTeam,
  insertRow,
  readRows,
  seedProject,
  seedTeamAccount,
  uniqueStamp,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * FILM-514: the Music timeline after the retired music vendor.
 *
 * Regenerate on a finished, non-cue music track (the shape ElevenLabs music
 * writes: a file, a scene number, no `isCue`) used to call the retired
 * vendor's scene action, which failed and left a second, failed track beside
 * the good one. Only cue tracks can be regenerated now, through ElevenLabs.
 * The header's two buttons that only ever reached that vendor are gone.
 */

const SERVICE_ROLE_KEY =
  process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const service = { key: SERVICE_ROLE_KEY };

const TRACK_NAME = 'Harbour theme at dusk';
const CUE_PROMPT = 'Low strings under the storm';

async function seedMusicEpisode() {
  const team = await seedTeamAccount({ emailPrefix: 'film514' });
  const project = await seedProject(team);

  const episode = await insertRow<{ id: string; slug: string }>(
    'episodes',
    {
      project_id: project.id,
      number: 1,
      title: 'The Harbour',
      slug: `film514-${uniqueStamp().slice(0, 8)}`,
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
            // The Audio Studio stays locked until a scene has dialogue.
            dialogue: [{ character: 'Ava', text: 'The boats are late.' }],
          },
        ],
      },
    },
    service,
  );

  // What elevenlabs-music-core.ts inserts: finished, scene-numbered, no isCue.
  await insertRow(
    'audio_tracks',
    {
      episode_id: episode.id,
      type: 'music',
      name: TRACK_NAME,
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
      prompt: CUE_PROMPT,
      start_offset_seconds: 40,
      duration_seconds: 20,
      status: 'pending',
    },
    service,
  );

  return { team, project, episode };
}

async function openMusicTimeline(
  page: Page,
  team: SeededTeam,
  projectSlug: string,
  episodeSlug: string,
) {
  await signInAs(page, team);
  await page.goto(
    `/home/${team.slug}/studio/${projectSlug}/episodes/${episodeSlug}/audio-studio`,
  );
  await page.getByRole('button', { name: /^Music/ }).click();
  await expect(page.getByText(TRACK_NAME)).toBeVisible();
}

test.describe('FILM-514: Music timeline', () => {
  test('a finished non-cue track cannot be regenerated; a cue can', async ({
    page,
  }) => {
    const { team, project, episode } = await seedMusicEpisode();

    await openMusicTimeline(page, team, project.slug, episode.slug);

    await expect(
      page.getByRole('button', { name: 'Generate for Scene' }),
    ).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add Cue' })).toHaveCount(0);

    await page.getByText(TRACK_NAME).click();
    await expect(
      page.getByRole('button', { name: 'Edit Prompt' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Regenerate' })).toHaveCount(
      0,
    );
    await page.keyboard.press('Escape');
    await page.mouse.click(5, 5);

    await page.getByText(CUE_PROMPT).click();
    await expect(
      page.getByRole('button', { name: 'Regenerate' }),
    ).toBeVisible();

    const tracks = await readRows<{ id: string }>(
      'audio_tracks',
      `episode_id=eq.${episode.id}&select=id`,
    );
    expect(tracks).toHaveLength(1);
  });

  test('a finished non-cue track can still be deleted', async ({ page }) => {
    const { team, project, episode } = await seedMusicEpisode();

    await openMusicTimeline(page, team, project.slug, episode.slug);

    await page.getByText(TRACK_NAME).click();
    await page.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText(TRACK_NAME)).toHaveCount(0);

    await expect
      .poll(
        async () =>
          (
            await readRows<{ id: string }>(
              'audio_tracks',
              `episode_id=eq.${episode.id}&select=id`,
            )
          ).length,
      )
      .toBe(0);
  });

  test('a cue on an episode in no season can be regenerated (KB-139)', async ({
    page,
  }) => {
    // `episodes.season_id` is nullable, and this episode has none: the cue
    // was found through `seasons!inner`, which drops it, so the action
    // answered with PostgREST's "cannot coerce … to a single JSON object".
    const { team, project, episode } = await seedMusicEpisode();
    await updateRows('projects', `id=eq.${project.id}`, {
      audio_settings: { elevenlabs: { music_model: 'music_v1' } },
    });

    await openMusicTimeline(page, team, project.slug, episode.slug);

    await page.getByText(CUE_PROMPT).click();
    await page.getByRole('button', { name: 'Regenerate' }).click();

    // The first answer is past the cue lookup: queued, or — where no job
    // queue is configured, as in the ⚫️ Test job — the queue step's own
    // failure. Before the fix it was the lookup's PostgREST error.
    const answer = page.locator('[data-sonner-toast]').first();
    await expect(answer).toContainText(
      /Music generation started|LLM_JOBS_QUEUE_URL/,
    );
    await expect(answer).not.toContainText(/single JSON object|Cue not found/);
  });
});
