import { notFound } from 'next/navigation';

import { ArrowLeft, BookCheck } from 'lucide-react';

import { FactLibrary } from '@kit/episodes';
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

    // Build query
    let query = client
        .from('verified_facts')
        .select('*', { count: 'exact' })
        .eq('project_id', project.id)
        .order('created_at', { ascending: false })
        .range(0, 49);

    if (filters.q) {
        query = query.textSearch(
            'claim',
            filters.q.split(/\s+/).join(' & '),
        );
    }

    if (filters.category) {
        query = query.eq('category', filters.category);
    }

    if (filters.status) {
        query = query.eq(
            'verification_status',
            filters.status as 'unverified' | 'verified' | 'disputed' | 'pending_review' | 'retracted',
        );
    }

    const { data: factsRaw, count } = await query;

    // Map to client format
    const facts = (factsRaw ?? []).map((row) => ({
        id: row.id,
        projectId: row.project_id,
        claim: row.claim,
        simplifiedClaim: row.simplified_claim,
        category: row.category,
        subcategory: row.subcategory,
        tags: row.tags ?? [],
        sourceType: row.source_type,
        sourceUrl: row.source_url,
        sourceCitation: row.source_citation,
        sourceTitle: row.source_title,
        sourceAuthors: row.source_authors ?? [],
        sourceDoi: row.source_doi,
        verificationStatus: row.verification_status,
        verifiedBy: row.verified_by,
        verifiedAt: row.verified_at,
        verificationNotes: row.verification_notes,
        confidenceScore: row.confidence_score,
        timesUsed: row.times_used ?? 0,
        lastUsedAt: row.last_used_at,
        episodesUsedIn: row.episodes_used_in ?? [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    }));

    const basePath = `/home/${account}/studio/${projectSlug}/settings/facts`;

    return (
        <div className="flex flex-col gap-6 px-1">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" asChild>
                        <a href={`/home/${account}/studio/${projectSlug}/settings`}>
                            <ArrowLeft className="h-4 w-4" />
                        </a>
                    </Button>
                    <BookCheck className="h-6 w-6 text-primary" />
                    <Heading level={3}>
                        <Trans i18nKey="projects:factLibrary" defaults="Fact Library" />
                    </Heading>
                </div>
            </div>

            <FactLibrary
                facts={facts}
                total={count ?? 0}
                basePath={basePath}
            />
        </div>
    );
}

export default FactsPage;
