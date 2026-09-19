import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft, Share2 } from 'lucide-react';

import {
  PlatformConnections,
  ProjectPublishingConfigs,
} from '@kit/publishing/components';
import {
  getAccountPlatformConnections,
  getProjectPublishingConfigs,
} from '@kit/publishing/server';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';

import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { withI18n } from '~/lib/i18n/with-i18n';

import { loadTeamWorkspace } from '../../../_lib/server/team-account-workspace.loader';

interface PlatformsPageProps {
  params: Promise<{ account: string; projectSlug: string }>;
}

export const generateMetadata = async ({ params }: PlatformsPageProps) => {
  const { projectSlug } = await params;
  const i18n = await createI18nServerInstance();

  try {
    const client = getSupabaseServerClient();
    const { data: project } = await client
      .from('projects')
      .select('name')
      .eq('slug', projectSlug)
      .single();

    if (!project) {
      return {
        title: i18n.t('projects:projectDetails'),
      };
    }

    return {
      title: `${project.name} - Platforms`,
    };
  } catch {
    return {
      title: i18n.t('projects:projectDetails'),
    };
  }
};

async function PlatformsPage({ params }: PlatformsPageProps) {
  const { account, projectSlug } = await params;

  // Load workspace to verify access and get account ID
  const workspace = await loadTeamWorkspace(account);
  const accountId = workspace.account.id;

  const client = getSupabaseServerClient();

  // Fetch project by slug
  const { data: project, error: projectError } = await client
    .from('projects')
    .select(
      `
            id, name, slug, description, account_id, metadata, status, visibility,
            created_at, updated_at
        `,
    )
    .eq('slug', projectSlug)
    .single();

  if (projectError || !project) {
    notFound();
  }

  // Fetch publishing configs and connections
  // Note: OAuth app credentials are now managed globally by sys admin
  const [publishingConfigs, platformConnections] = await Promise.all([
    getProjectPublishingConfigs(project.id),
    getAccountPlatformConnections(project.account_id ?? ''),
  ]);

  return (
    <>
      {/* Fixed Header */}
      <header className="border-b border-gray-200 bg-card px-6 py-4">
        <div className="mb-2">
          <Link
            href={`/home/${account}/studio/${project.slug}`}
            className="inline-flex items-center text-sm text-gray-500 transition-colors hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Project
          </Link>
        </div>
        <div className="flex items-center gap-3">
          <Share2 className="h-5 w-5 text-gray-400 dark:text-gray-500" />
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">
            Platforms
          </h1>
        </div>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Connect platform accounts and configure publishing destinations
        </p>
      </header>

      {/* Content */}
      <div className="flex-1">
        <div className="mx-auto max-w-4xl space-y-6 p-6">
          <Tabs defaultValue="connections" className="space-y-6">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="connections">Connect Accounts</TabsTrigger>
              <TabsTrigger value="destinations">Destinations</TabsTrigger>
            </TabsList>

            {/* Tab 1: Connect Platform Accounts */}
            <TabsContent value="connections" className="space-y-4">
              <div className="text-sm text-gray-600 dark:text-gray-400">
                Connect your YouTube, TikTok, and Instagram accounts to enable
                publishing.
              </div>
              <PlatformConnections
                accountSlug={account}
                accountId={accountId}
              />
            </TabsContent>

            {/* Tab 2: Project Destinations */}
            <TabsContent value="destinations" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Publishing Destinations</CardTitle>
                  <CardDescription>
                    Select which connected platforms to use for this project.
                    Each platform can publish a specific language version.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ProjectPublishingConfigs
                    projectId={project.id}
                    configs={publishingConfigs}
                    availableConnections={platformConnections}
                  />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </>
  );
}

export default withI18n(PlatformsPage);
