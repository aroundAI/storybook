import type { Metadata } from 'next';

import { notFound } from 'next/navigation';

import {
  matchesScheduleFilters,
  parseScheduleFilters,
} from '@kit/publishing/lib/schedule-view';
import { readPublishCalendar } from '@kit/publishing/server/publish-calendar';
import {
  getAccountPlatformConnections,
  getProjectChannelSelection,
} from '@kit/publishing/server/queries';
import { readChannelCadences } from '@kit/publishing/server/schedule-release';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { PageBody, PageHeader } from '@kit/ui/page';

import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { withI18n } from '~/lib/i18n/with-i18n';

import { loadTeamWorkspace } from '../../../_lib/server/team-account-workspace.loader';
import { PostingRulesSection } from './_components/posting-rules-section';
import { ScheduleFilters } from './_components/schedule-filters';
import { ScheduleTable } from './_components/schedule-table';

interface SchedulePageProps {
  params: Promise<{ account: string; projectSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

const DESCRIPTION =
  'What this project has published and what is scheduled, on every channel, and each channel’s posting rules.';

export async function generateMetadata({
  params,
}: SchedulePageProps): Promise<Metadata> {
  const { account, projectSlug } = await params;
  const [i18n, workspace] = await Promise.all([
    createI18nServerInstance(),
    loadTeamWorkspace(account),
  ]);
  const title = i18n.t('studio:routes.schedule');

  const { data: project } = await getSupabaseServerClient()
    .from('projects')
    .select('name')
    .eq('slug', projectSlug)
    .eq('account_id', workspace.account.id)
    .maybeSingle();

  return {
    title: project?.name ? `${project.name} - ${title}` : title,
    description: DESCRIPTION,
  };
}

/**
 * FILM-2211. A project's posts in one table, published and scheduled, with
 * its channels' posting rules above: the rules are the channel's, so they
 * are edited here without opening an episode.
 */
async function SchedulePage({ params, searchParams }: SchedulePageProps) {
  const { account, projectSlug } = await params;
  const client = getSupabaseServerClient();
  const workspace = await loadTeamWorkspace(account);

  // Slugs are unique per account, so the lookup is scoped to it
  const { data: project } = await client
    .from('projects')
    .select('id, slug')
    .eq('slug', projectSlug)
    .eq('account_id', workspace.account.id)
    .maybeSingle();

  if (!project) {
    notFound();
  }

  const filters = parseScheduleFilters(await searchParams, new Date());

  const [connections, channelIds, posts] = await Promise.all([
    getAccountPlatformConnections(workspace.account.id),
    getProjectChannelSelection(project.id),
    readPublishCalendar(client, { projectId: project.id, ...filters.range }),
  ]);

  const channels = connections.filter((c) => channelIds.includes(c.id));
  const cadences = channels.length
    ? await readChannelCadences(
        client,
        channels.map((c) => c.id),
      )
    : [];

  const names = new Map(connections.map((c) => [c.id, c.platformAccountName]));
  const rows = posts
    .filter((post) => matchesScheduleFilters(post, filters))
    .map((post) => ({
      ...post,
      channelName: post.connectionId
        ? (names.get(post.connectionId) ?? null)
        : null,
    }));

  const basePath = `/home/${account}/studio/${project.slug ?? project.id}`;

  return (
    <>
      <PageHeader title="Schedule" description={DESCRIPTION} />

      <PageBody>
        <div className="space-y-6 pb-8" data-test="schedule-page">
          <PostingRulesSection
            channels={channels.map((channel) => ({
              id: channel.id,
              name: channel.platformAccountName ?? channel.platform,
              platform: channel.platform,
              cadences: cadences.filter((c) => c.connectionId === channel.id),
            }))}
            platformsHref={`${basePath}/platforms`}
          />

          <ScheduleFilters
            filters={{ from: filters.from, to: filters.to }}
            clamped={filters.clamped}
          />

          <ScheduleTable
            rows={rows}
            episodesHref={`${basePath}/episodes`}
            from={filters.from}
            to={filters.to}
          />
        </div>
      </PageBody>
    </>
  );
}

export default withI18n(SchedulePage);
