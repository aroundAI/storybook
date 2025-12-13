import type { Metadata } from 'next';

import { notFound } from 'next/navigation';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { PageBody } from '@kit/ui/page';

import { withI18n } from '~/lib/i18n/with-i18n';

import { ActionCard } from './_components/action-card';
import { ProjectBanner } from './_components/project-banner';

interface StudioProjectPageProps {
  params: Promise<{
    account: string;
    projectId: string;
  }>;
}

export async function generateMetadata({
  params,
}: StudioProjectPageProps): Promise<Metadata> {
  const { projectId } = await params;
  const client = getSupabaseServerClient();

  const { data: project } = await client
    .from('projects')
    .select('name')
    .eq('id', projectId)
    .single();

  return {
    title: project?.name ?? 'Project Dashboard',
    description: 'Manage your film project',
  };
}

async function StudioProjectPage({ params }: StudioProjectPageProps) {
  const { account, projectId } = await params;
  const client = getSupabaseServerClient();

  const { data: project, error } = await client
    .from('projects')
    .select('id, name, description, metadata, created_at')
    .eq('id', projectId)
    .single();

  if (error || !project) {
    notFound();
  }

  // Extract metadata
  const metadata = (project.metadata ?? {}) as {
    genre?: string;
    targetAudience?: string;
  };

  // Fetch asset counts in parallel for better performance
  const [
    { count: characterCount },
    { count: locationCount },
    { count: voiceCount },
    { count: episodeCount },
  ] = await Promise.all([
    client
      .from('assets')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('type', 'character')
      .is('deleted_at', null),
    client
      .from('assets')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('type', 'location')
      .is('deleted_at', null),
    client
      .from('assets')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('type', 'voice')
      .is('deleted_at', null),
    client
      .from('episodes')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .is('deleted_at', null),
  ]);

  const baseUrl = `/home/${account}/studio/${projectId}`;
  const hasCharacters = (characterCount ?? 0) > 0;
  const hasLocations = (locationCount ?? 0) > 0;
  const hasEpisodes = (episodeCount ?? 0) > 0;

  return (
    <>
      {/* Branded Project Banner */}
      <div className="px-8 pt-8">
        <ProjectBanner
          name={project.name}
          description={project.description ?? ''}
          genre={metadata.genre}
          targetAudience={metadata.targetAudience}
        />
      </div>

      <PageBody>
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
          {/* Characters Card */}
          <ActionCard
            title="Characters"
            description="Create and manage your cast of characters with detailed profiles and personalities."
            iconName="user"
            href={hasCharacters ? `${baseUrl}/assets?type=character` : undefined}
            isEmpty={!hasCharacters}
            stats={
              hasCharacters
                ? [{ label: 'characters', value: characterCount ?? 0 }]
                : undefined
            }
            primaryAction={
              !hasCharacters
                ? {
                  label: 'Create First Character',
                  href: `${baseUrl}/assets?create=character`,
                }
                : {
                  label: 'Add Character',
                  href: `${baseUrl}/assets?create=character`,
                }
            }
            secondaryAction={
              hasCharacters
                ? {
                  label: 'View All',
                  href: `${baseUrl}/assets?type=character`,
                }
                : undefined
            }
            colorScheme="warm"
          />

          {/* Locations Card */}
          <ActionCard
            title="Locations"
            description="Define the worlds and settings where your stories take place."
            iconName="mapPin"
            href={hasLocations ? `${baseUrl}/assets?type=location` : undefined}
            isEmpty={!hasLocations}
            stats={
              hasLocations
                ? [{ label: 'locations', value: locationCount ?? 0 }]
                : undefined
            }
            primaryAction={
              !hasLocations
                ? {
                  label: 'Create First Location',
                  href: `${baseUrl}/assets?create=location`,
                }
                : {
                  label: 'Add Location',
                  href: `${baseUrl}/assets?create=location`,
                }
            }
            secondaryAction={
              hasLocations
                ? {
                  label: 'View All',
                  href: `${baseUrl}/assets?type=location`,
                }
                : undefined
            }
            colorScheme="cool"
          />

          {/* Episodes Card */}
          <ActionCard
            title="Episodes"
            description="Write stories, create screenplays, and generate shot lists for your video content."
            iconName="fileText"
            href={hasEpisodes ? `${baseUrl}/episodes` : undefined}
            isEmpty={!hasEpisodes}
            stats={
              hasEpisodes
                ? [{ label: 'episodes', value: episodeCount ?? 0 }]
                : undefined
            }
            primaryAction={
              !hasEpisodes
                ? {
                  label: 'Create First Episode',
                  href: `${baseUrl}/episodes`,
                }
                : {
                  label: 'New Episode',
                  href: `${baseUrl}/episodes?create=true`,
                }
            }
            secondaryAction={
              hasEpisodes
                ? {
                  label: 'View All',
                  href: `${baseUrl}/episodes`,
                }
                : {
                  label: 'Generate Season',
                  href: `${baseUrl}/episodes?generate=season`,
                }
            }
            colorScheme="primary"
          />
        </div>
      </PageBody>
    </>
  );
}

export default withI18n(StudioProjectPage);
