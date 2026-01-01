import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft, Share2 } from 'lucide-react';

import { ProjectPublishingConfigs } from '@kit/publishing/components';
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

    // Load workspace to verify access
    await loadTeamWorkspace(account);

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

    // Fetch publishing configs
    const [publishingConfigs, platformConnections] = await Promise.all([
        getProjectPublishingConfigs(project.id),
        getAccountPlatformConnections(project.account_id ?? ''),
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
                    Configure publishing destinations for episodes in this project
                </p>
            </header>

            {/* Content */}
            <div className="flex-1">
                <div className="mx-auto max-w-4xl space-y-6 p-6">
                    {/* Publishing Destinations Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle>Publishing Destinations</CardTitle>
                            <CardDescription>
                                Select which platforms to publish episodes to. Each platform can
                                be configured to receive a specific language version of your
                                content.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <ProjectPublishingConfigs
                                projectId={project.id}
                                configs={publishingConfigs}
                                availableConnections={platformConnections}
                                addConnectionUrl={`/home/${account}/settings/platforms`}
                            />
                        </CardContent>
                    </Card>

                    {/* Help Card */}
                    <Card>
                        <CardHeader>
                            <CardTitle>How it works</CardTitle>
                        </CardHeader>
                        <CardContent className="text-sm text-gray-600 dark:text-gray-400">
                            <ol className="list-inside list-decimal space-y-2">
                                <li>
                                    <strong>Connect platforms</strong> at the account level (YouTube, TikTok, etc.)
                                </li>
                                <li>
                                    <strong>Add destinations</strong> for this project from your connected platforms
                                </li>
                                <li>
                                    <strong>Select language</strong> version to publish (en, hi, es, pt)
                                </li>
                                <li>
                                    <strong>Publish episodes</strong> with one click from the Publish tab
                                </li>
                            </ol>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </>
    );
}

export default withI18n(PlatformsPage);
