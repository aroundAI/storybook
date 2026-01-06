import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft, Share2 } from 'lucide-react';

import {
    OAuthAppConfig,
    PlatformConnections,
    ProjectPublishingConfigs,
} from '@kit/publishing/components';
import {
    getAccountOAuthApps,
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
        .select('*')
        .eq('slug', projectSlug)
        .single();

    if (projectError || !project) {
        notFound();
    }

    // Fetch publishing configs, connections, and OAuth apps
    const [publishingConfigs, platformConnections, oauthApps] = await Promise.all([
        getProjectPublishingConfigs(project.id),
        getAccountPlatformConnections(project.account_id ?? ''),
        getAccountOAuthApps(accountId),
    ]);

    return (
        <>
            {/* Fixed Header */}
            <header className="border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-800 dark:bg-gray-900">
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
                    Configure OAuth apps and connect publishing platforms
                </p>
            </header>

            {/* Content */}
            <div className="flex-1">
                <div className="mx-auto max-w-4xl space-y-6 p-6">
                    <Tabs defaultValue="credentials" className="space-y-6">
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="credentials">App Credentials</TabsTrigger>
                            <TabsTrigger value="connections">Connect Accounts</TabsTrigger>
                            <TabsTrigger value="destinations">Destinations</TabsTrigger>
                        </TabsList>

                        {/* Tab 1: Configure OAuth App Credentials */}
                        <TabsContent value="credentials" className="space-y-4">
                            <div className="text-sm text-gray-600 dark:text-gray-400">
                                Configure your OAuth app credentials to enable connecting platform accounts.
                                This is a one-time setup per platform.
                            </div>
                            <OAuthAppConfig
                                accountId={accountId}
                                existingApps={oauthApps}
                            />
                        </TabsContent>

                        {/* Tab 2: Connect Platform Accounts */}
                        <TabsContent value="connections" className="space-y-4">
                            <div className="text-sm text-gray-600 dark:text-gray-400">
                                Connect your YouTube, TikTok, and Instagram accounts to enable publishing.
                            </div>
                            <PlatformConnections
                                accountSlug={account}
                                accountId={accountId}
                            />
                        </TabsContent>

                        {/* Tab 3: Project Destinations */}
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

