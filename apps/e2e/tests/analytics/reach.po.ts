import { Page } from '@playwright/test';

import {
  SeededTeam,
  insertRow,
  seedProject,
  seedTeamAccount,
  seedYouTubeConnection,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

const SERVICE_ROLE_KEY =
  process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

export interface ReachFixture {
  team: SeededTeam;
  projectId: string;
  instagram: { connectionId: string; postId: string };
  youtube: { connectionId: string; videoId: string };
}

/** The reach page (cross-platform reach design), and one team to show it. */
export class ReachPageObject {
  constructor(private readonly page: Page) {}

  /** A team with one Instagram and one YouTube channel, a post on each. */
  async setup(): Promise<ReachFixture> {
    const team = await seedTeamAccount({ emailPrefix: 'reach' });
    const project = await seedProject(team);

    const instagram = await seedYouTubeConnection(
      team.accountId,
      'Harbour Instagram',
      { platform: 'instagram' },
    );
    const youtube = await seedYouTubeConnection(
      team.accountId,
      'Harbour YouTube',
    );

    const publish = async (
      connectionId: string,
      platform: string,
      title: string,
      number: number,
    ) => {
      const episode = await insertRow<{ id: string }>(
        'episodes',
        { project_id: project.id, number, title },
        { key: SERVICE_ROLE_KEY },
      );
      const row = await insertRow<{ id: string }>(
        'publishes',
        {
          episode_id: episode.id,
          platform_connection_id: connectionId,
          platform,
          status: 'published',
          title,
          published_at: new Date(Date.now() - 20 * 86_400_000).toISOString(),
        },
        { key: SERVICE_ROLE_KEY },
      );

      return row.id;
    };

    await signInAs(this.page, team);

    return {
      team,
      projectId: project.id,
      instagram: {
        connectionId: instagram,
        postId: await publish(instagram, 'instagram', 'Harbour reel', 1),
      },
      youtube: {
        connectionId: youtube,
        videoId: await publish(youtube, 'youtube', 'Harbour long cut', 2),
      },
    };
  }

  async open(
    team: SeededTeam,
    query: { tab?: string; view?: string; window?: number } = {},
  ) {
    const params = new URLSearchParams({
      tab: query.tab ?? 'all',
      view: query.view ?? 'channel',
      window: String(query.window ?? 7),
    });

    await this.page.goto(
      `/home/${team.slug}/studio/analytics/reach?${params.toString()}`,
    );
    await byTest(this.page, 'reach-overview').waitFor();
  }

  channel(connectionId: string) {
    return byTest(this.page, `channel-reach-${connectionId}`);
  }

  count(metric: 'views' | 'comments' | 'shares') {
    return byTest(byTest(this.page, `reach-count-${metric}`), 'reach-count-value');
  }

  postRow(title: string) {
    return byTest(this.page, 'reach-post-row').filter({ hasText: title });
  }
}
