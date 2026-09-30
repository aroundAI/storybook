import type { Page } from '@playwright/test';

import {
  type SeededProject,
  type SeededTeam,
  insertRow,
  readRows,
  seedCharacters,
  seedEpisodeWithShot,
  seedProject,
  seedTeamAccount,
  serviceRoleAuth,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

export interface CanonFixture {
  team: SeededTeam;
  project: SeededProject;
  episodeId: string;
  episodeSlug: string;
  characterId: string;
  threadId: string;
  eventId: string;
}

/**
 * A team with canon on and one of each thing the canon panels show: an
 * immutable event, an open thread and a character with an emotional state.
 * Seeded through the API, as the other canon specs do.
 */
export async function seedCanon(prefix: string): Promise<CanonFixture> {
  const team = await seedTeamAccount({ emailPrefix: prefix });
  const project = await seedProject(team, { name: `${prefix} canon` });

  await updateRows('projects', `id=eq.${project.id}`, {
    metadata: { canon: { enabled: true } },
  });

  const episode = await seedEpisodeWithShot(project.id);
  await updateRows('episodes', `id=eq.${episode.episodeId}`, {
    status: 'story',
    number: 2,
    story_data: { fullStory: 'Mara held the gate until the last light.' },
    screenplay_data: {
      scenes: [
        {
          number: 1,
          heading: 'INT. LIGHTHOUSE - NIGHT',
          location: 'Lighthouse',
          timeOfDay: 'night',
          description: 'Mara studies the map by lamplight, recalling the pact.',
          dialogue: [{ character: 'Mara', text: 'The key was here.' }],
          estimatedDuration: 30,
        },
        {
          number: 2,
          heading: 'EXT. HARBOUR - DAWN',
          location: 'Harbour',
          timeOfDay: 'dawn',
          description: 'Ilya walked the pier and spoke to no one.',
          dialogue: [],
          estimatedDuration: 20,
        },
      ],
      metadata: {
        totalScenes: 2,
        estimatedDuration: 50,
        locations: ['Lighthouse', 'Harbour'],
        characters: ['Mara', 'Ilya'],
      },
    },
  });

  const auth = serviceRoleAuth();

  const event = await insertRow<{ id: string }>(
    'immutable_events',
    {
      project_id: project.id,
      event_type: 'death',
      event_key: 'character:ilya:dead',
      established_in: episode.episodeId,
      season: 1,
      episode_number: 1,
      description: 'Ilya died in the flood of the lower harbour.',
    },
    auth,
  );

  const thread = await insertRow<{ id: string }>(
    'narrative_threads',
    {
      project_id: project.id,
      thread_name: 'The missing key',
      thread_type: 'mystery',
      opened_at: episode.episodeId,
      status: 'open',
      promises: ['Who took the key'],
      description: 'Someone took the key before the flood.',
    },
    auth,
  );

  await seedCharacters(team, project.id, 1);
  const [character] = await readRows<{ id: string }>(
    'assets',
    `project_id=eq.${project.id}&type=eq.character&select=id`,
  );

  await updateRows('assets', `id=eq.${character!.id}`, { name: 'Mara' });

  await insertRow(
    'character_states',
    {
      character_id: character!.id,
      episode_id: episode.episodeId,
      state_type: 'emotional',
      state_value: { state: 'calm' },
      trigger_event: 'seeded',
      created_by: team.userId,
    },
    auth,
  );

  return {
    team,
    project,
    episodeId: episode.episodeId,
    episodeSlug: episode.slug,
    characterId: character!.id,
    threadId: thread.id,
    eventId: event.id,
  };
}

export async function openStoryCanon(page: Page, canon: CanonFixture) {
  await signInAs(page, canon.team);
  await page.goto(
    `/home/${canon.team.slug}/studio/${canon.project.slug}/episodes/${canon.episodeSlug}/story`,
  );
  // The story's sidebar starts collapsed, off the right edge.
  await byTest(page, 'story-sidebar-toggle').click();
  await byTest(page, 'story-canon-tab').click();
}

export async function openScreenplay(page: Page, canon: CanonFixture) {
  await signInAs(page, canon.team);
  await page.goto(
    `/home/${canon.team.slug}/studio/${canon.project.slug}/episodes/${canon.episodeSlug}/screenplay`,
  );
}
