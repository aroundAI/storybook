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
 * KB-92: a cue on a shot with no scene number is saved with no scene, and the
 * SFX list shows it without a "Scene N" prefix, beside a cue that has one.
 *
 * Screenshots for the PR are written only when CAPTURE_EVIDENCE is set.
 */
const EVIDENCE = process.env.CAPTURE_EVIDENCE
  ? (process.env.EVIDENCE_DIR ?? 'evidence')
  : null;

test.describe('Audio cues without a scene (KB-92)', () => {
  test('the SFX list shows a sceneless cue beside a numbered one', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb92' });
    const project = await seedProject(team);
    const slug = `kb92-episode-${uniqueStamp().slice(0, 8)}`;

    const episode = await insertRow<{ id: string }>(
      'episodes',
      {
        project_id: project.id,
        number: 1,
        title: 'The Lighthouse',
        slug,
        story_data: { title: 'The Lighthouse' },
        // The Audio Studio opens once the screenplay has a line of dialogue.
        screenplay_data: {
          scenes: [
            {
              number: 1,
              heading: 'INT. LIGHTHOUSE - NIGHT',
              dialogue: [{ character: 'MARA', line: 'Who lit the lamp?' }],
            },
          ],
        },
        shot_list: { shots: [] },
      },
      serviceRoleAuth(),
    );

    for (const cue of [
      { scene_number: 3, prompt: 'Door creaks open', start: 0 },
      { scene_number: null, prompt: 'Rain on the window', start: 5 },
    ]) {
      await insertRow(
        'audio_cues',
        {
          episode_id: episode.id,
          scene_number: cue.scene_number,
          cue_type: 'sfx',
          prompt: cue.prompt,
          start_offset_seconds: cue.start,
          duration_seconds: 4,
        },
        serviceRoleAuth(),
      );
    }

    await signInAs(page, team);
    await page.goto(
      `/home/${team.slug}/studio/${project.slug}/episodes/${slug}/audio-studio`,
    );

    const sfxTab = byTest(page, 'audio-tab-sfx');
    const meta = byTest(page, 'sfx-cue-meta');

    // A click before hydration is dropped; retry until the list appears.
    await expect(async () => {
      await sfxTab.click();
      await expect(meta).toHaveCount(2, { timeout: 5_000 });
    }).toPass({ timeout: 60_000 });

    const labels = (await meta.allTextContents()).map((text) =>
      text.replace(/\s+/g, ' ').trim(),
    );

    expect(labels).toEqual(['Scene 3 | sfx | 0:04', 'sfx | 0:04']);

    if (EVIDENCE) {
      await page.screenshot({
        path: `${EVIDENCE}/kb92-audio-studio-sfx.png`,
        fullPage: true,
      });
    }
  });
});
