import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ArrowLeft, BookCheck } from 'lucide-react';

import { FactLibrary } from '@kit/episodes/components';
import { getProjectFactsAction } from '@kit/episodes/server';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Button } from '@kit/ui/button';
import { Heading } from '@kit/ui/heading';
import { Trans } from '@kit/ui/trans';

import { loadTeamWorkspace } from '../../../../_lib/server/team-account-workspace.loader';

interface FactsPageProps {
    params: Promise<{ account: string; projectSlug: string }>;
    searchParams: Promise<{
        q?: string;
        category?: string;
        status?: string;
    }>;
}

export const generateMetadata = async ({ params }: FactsPageProps) => {
    const { projectSlug } = await params;
    const client = getSupabaseServerClient();
    const { data: project } = await client
        .from('projects')
        .select('name')
        .eq('slug', projectSlug)
        .single();

    return {
        title: project ? `${project.name} - Fact Library` : 'Fact Library',
    };
};

async function FactsPage({ params, searchParams }: FactsPageProps) {
    const { account, projectSlug } = await params;
    const filters = await searchParams;

    await loadTeamWorkspace(account);

    const client = getSupabaseServerClient();

    const { data: project, error: projectError } = await client
        .from('projects')
        .select('id, name, slug')
        .eq('slug', projectSlug)
        .single();

    if (projectError || !project) {
        notFound();
    }

    // Validate status against allowed values; pass undefined for invalid/missing
    const validStatuses = ['unverified', 'verified', 'disputed', 'pending_review', 'retracted'] as const;
    const status = validStatuses.find((s) => s === filters.status);

    // Use shared action to fetch facts (single source of query logic)
    const result = await getProjectFactsAction({
        projectId: project.id,
        search: filters.q,
        category: filters.category,
        status,
        limit: 50,
        offset: 0,
    });

    const basePath = `/home/${account}/studio/${projectSlug}/settings/facts`;

    return (
        <div className="flex flex-col gap-6 px-1">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" asChild>
                        <Link
                            href={`/home/${account}/studio/${projectSlug}/settings`}
                        >
                            <ArrowLeft className="h-4 w-4" />
                        </Link>
                    </Button>
                    <BookCheck className="h-6 w-6 text-primary" />
                    <Heading level={3}>
                        <Trans
                            i18nKey="projects:factLibrary"
                            defaults="Fact Library"
                        />
                    </Heading>
                </div>
            </div>

            <FactLibrary
                facts={result.facts}
                total={result.total}
                basePath={basePath}
                projectId={project.id}
            />
        </div>
    );
}

export default FactsPage;
