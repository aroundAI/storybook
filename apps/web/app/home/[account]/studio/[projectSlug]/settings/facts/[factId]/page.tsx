import { cache } from 'react';

import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  ArrowLeft,
  BookCheck,
  Calendar,
  ExternalLink,
  Tag,
  User,
} from 'lucide-react';

import {
  SOURCE_TYPES,
  STATUS_LABELS,
  STATUS_STYLES,
} from '@kit/episodes/components';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Heading } from '@kit/ui/heading';

import { loadTeamWorkspace } from '../../../../../_lib/server/team-account-workspace.loader';

interface FactDetailPageProps {
  params: Promise<{ account: string; projectSlug: string; factId: string }>;
}

const getProjectBySlug = cache(async (slug: string) => {
  const client = getSupabaseServerClient();
  const { data } = await client
    .from('projects')
    .select('id')
    .eq('slug', slug)
    .single();
  return data;
});

export const generateMetadata = async ({ params }: FactDetailPageProps) => {
  const { factId, projectSlug } = await params;

  const project = await getProjectBySlug(projectSlug);

  if (!project) {
    return { title: 'Fact Details' };
  }

  const client = getSupabaseServerClient();
  const { data: fact } = await client
    .from('verified_facts')
    .select('claim')
    .eq('id', factId)
    .eq('project_id', project.id)
    .single();

  return {
    title: fact ? `Fact: ${fact.claim.slice(0, 60)}` : 'Fact Details',
  };
};

async function FactDetailPage({ params }: FactDetailPageProps) {
  const { account, projectSlug, factId } = await params;

  const [, project] = await Promise.all([
    loadTeamWorkspace(account),
    getProjectBySlug(projectSlug),
  ]);

  if (!project) {
    notFound();
  }

  const client = getSupabaseServerClient();
  const { data: fact, error } = await client
    .from('verified_facts')
    .select('*')
    .eq('id', factId)
    .eq('project_id', project.id)
    .single();

  if (error || !fact) {
    notFound();
  }

  const basePath = `/home/${account}/studio/${projectSlug}/settings/facts`;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-1">
      {/* Back nav */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href={basePath}>
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <BookCheck className="h-5 w-5 text-primary" />
        <Heading level={4}>Fact Details</Heading>
      </div>

      {/* Main Claim */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="text-lg leading-relaxed">
                {fact.claim}
              </CardTitle>
              {fact.simplified_claim && (
                <CardDescription className="mt-2">
                  Simplified: {fact.simplified_claim}
                </CardDescription>
              )}
            </div>
            <Badge
              className={
                STATUS_STYLES[fact.verification_status] ??
                STATUS_STYLES.unverified
              }
            >
              {STATUS_LABELS[fact.verification_status] ??
                fact.verification_status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Tags */}
          {fact.tags && fact.tags.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Tag className="h-4 w-4 text-muted-foreground" />
              {fact.tags.map((tag) => (
                <Badge key={tag} variant="secondary" className="text-xs">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          {/* Category */}
          <div className="grid grid-cols-2 gap-4 text-sm">
            {fact.category && (
              <div>
                <span className="text-muted-foreground">Category:</span>{' '}
                <span className="capitalize">{fact.category}</span>
              </div>
            )}
            {fact.subcategory && (
              <div>
                <span className="text-muted-foreground">Subcategory:</span>{' '}
                {fact.subcategory}
              </div>
            )}
          </div>

          {/* Confidence */}
          {fact.confidence_score != null && (
            <div className="text-sm">
              <span className="text-muted-foreground">Confidence:</span>{' '}
              <span className="font-medium">
                {Math.round(fact.confidence_score * 100)}%
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Source Information */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Source Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <span className="text-muted-foreground">Source Type:</span>{' '}
            <span className="capitalize">
              {SOURCE_TYPES.find((st) => st.value === fact.source_type)
                ?.label ?? fact.source_type.replace(/_/g, ' ')}
            </span>
          </div>

          {fact.source_title && (
            <div>
              <span className="text-muted-foreground">Title:</span>{' '}
              {fact.source_title}
            </div>
          )}

          {fact.source_authors && fact.source_authors.length > 0 && (
            <div className="flex items-center gap-1">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Authors:</span>{' '}
              {fact.source_authors.join(', ')}
            </div>
          )}

          {fact.source_citation && (
            <div className="rounded-md bg-muted/50 p-3 text-sm italic">
              {fact.source_citation}
            </div>
          )}

          {fact.source_url && (
            <Button variant="outline" size="sm" asChild>
              <a
                href={fact.source_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                View Source
              </a>
            </Button>
          )}

          {fact.source_doi && (
            <div>
              <span className="text-muted-foreground">DOI:</span>{' '}
              <a
                href={`https://doi.org/${fact.source_doi}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:underline"
              >
                {fact.source_doi}
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Verification & Usage */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Verification & Usage</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {fact.verification_notes && (
            <div>
              <span className="text-muted-foreground">Verification Notes:</span>
              <p className="mt-1">{fact.verification_notes}</p>
            </div>
          )}

          {fact.verified_at && (
            <div className="flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Verified:</span>{' '}
              {new Date(fact.verified_at).toLocaleDateString()}
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-muted-foreground">Times Used:</span>{' '}
              <span className="font-medium">{fact.times_used ?? 0}</span>
            </div>
            {fact.last_used_at && (
              <div>
                <span className="text-muted-foreground">Last Used:</span>{' '}
                {new Date(fact.last_used_at).toLocaleDateString()}
              </div>
            )}
          </div>

          {fact.episodes_used_in && fact.episodes_used_in.length > 0 && (
            <div>
              <span className="text-muted-foreground">
                Used in {fact.episodes_used_in.length} episode(s)
              </span>
            </div>
          )}

          {fact.created_at && (
            <div className="border-t pt-2 text-xs text-muted-foreground">
              Created: {new Date(fact.created_at).toLocaleString()}
              {fact.updated_at &&
                ` · Updated: ${new Date(fact.updated_at).toLocaleString()}`}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default FactDetailPage;
