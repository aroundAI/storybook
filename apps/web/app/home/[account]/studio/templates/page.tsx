import { Suspense } from 'react';

import Link from 'next/link';

import { ChevronLeft, Plus } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Heading } from '@kit/ui/heading';

import { withI18n } from '~/lib/i18n/with-i18n';

import { TemplateLibrary } from './_components/template-library';
import { TemplateLibrarySkeleton } from './_components/template-library-skeleton';

export const metadata = {
  title: 'Project Templates | Film Studio',
  description: 'Browse and create projects from templates',
};

interface PageProps {
  params: Promise<{ account: string }>;
  searchParams: Promise<{ category?: string }>;
}

async function TemplatesPage({ params, searchParams }: PageProps) {
  const { account } = await params;
  const { category } = await searchParams;

  return (
    <div className="container mx-auto py-8">
      <div className="mb-8">
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href={`/home/${account}/studio`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to Studio
          </Link>
        </Button>

        <div className="flex items-center justify-between">
          <div>
            <Heading level={2}>Project Templates</Heading>
            <p className="text-muted-foreground mt-2">
              Start your project with a pre-configured template or browse system
              templates.
            </p>
          </div>
          <Button asChild>
            <Link href={`/home/${account}/studio/projects/new`}>
              <Plus className="mr-2 h-4 w-4" />
              Blank Project
            </Link>
          </Button>
        </div>
      </div>

      <Suspense fallback={<TemplateLibrarySkeleton />}>
        <TemplateLibrary
          accountSlug={account}
          initialCategory={
            category as
              | 'series'
              | 'film'
              | 'shorts'
              | 'documentary'
              | 'educational'
              | undefined
          }
        />
      </Suspense>
    </div>
  );
}

export default withI18n(TemplatesPage);
