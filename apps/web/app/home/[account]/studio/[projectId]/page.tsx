import type { Metadata } from 'next';

import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowRight, FileText, User } from 'lucide-react';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { PageBody, PageHeader } from '@kit/ui/page';

import { withI18n } from '~/lib/i18n/with-i18n';

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
    .select('id, name, description, created_at')
    .eq('id', projectId)
    .single();

  if (error || !project) {
    notFound();
  }

  // Fetch asset counts in parallel for better performance
  const [
    { count: characterCount },
    { count: locationCount },
    { count: voiceCount },
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
  ]);

  const baseUrl = `/home/${account}/studio/${projectId}`;

  return (
    <>
      <PageHeader
        title={project.name}
        description={project.description ?? 'Film Studio Project'}
      />

      <PageBody>
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {/* Assets Card */}
          <Link href={`${baseUrl}/assets`}>
            <Card className="cursor-pointer transition-shadow hover:shadow-lg">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <User className="text-primary h-8 w-8" />
                  <ArrowRight className="text-muted-foreground h-5 w-5" />
                </div>
                <CardTitle>Assets</CardTitle>
                <CardDescription>
                  Characters, locations, and voice profiles
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-muted-foreground flex gap-4 text-sm">
                  <span>{characterCount ?? 0} characters</span>
                  <span>{locationCount ?? 0} locations</span>
                  <span>{voiceCount ?? 0} voices</span>
                </div>
              </CardContent>
            </Card>
          </Link>

          {/* Episodes Card */}
          <Link href={`${baseUrl}/episodes`}>
            <Card className="cursor-pointer transition-shadow hover:shadow-lg">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <FileText className="text-primary h-8 w-8" />
                  <ArrowRight className="text-muted-foreground h-5 w-5" />
                </div>
                <CardTitle>Episodes</CardTitle>
                <CardDescription>
                  Stories, screenplays, and shot lists
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-muted-foreground text-sm">
                  Coming soon...
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </PageBody>
    </>
  );
}

export default withI18n(StudioProjectPage);
