import { Suspense } from 'react';

import Link from 'next/link';

import { ChevronLeft } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Heading } from '@kit/ui/heading';

import { withI18n } from '~/lib/i18n/with-i18n';

import { CreateFilmProjectForm } from './_components/create-film-project-form';

export const metadata = {
  title: 'Create New Project | Film Studio',
  description: 'Create a new Film Studio project with custom settings',
};

interface PageProps {
  params: Promise<{ account: string }>;
}

async function NewFilmProjectPage({ params }: PageProps) {
  const { account } = await params;

  return (
    <div className="container mx-auto max-w-4xl py-8">
      <div className="mb-8">
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href={`/home/${account}/studio`}>
            <ChevronLeft className="mr-1 h-4 w-4" />
            Back to Studio
          </Link>
        </Button>

        <Heading level={2}>Create New Project</Heading>
        <p className="text-muted-foreground mt-2">
          Set up your Film Studio project with custom settings for video and
          audio generation.
        </p>
      </div>

      <Suspense fallback={<FormSkeleton />}>
        <CreateFilmProjectForm accountSlug={account} />
      </Suspense>
    </div>
  );
}

function FormSkeleton() {
  return (
    <div className="animate-pulse space-y-8">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="rounded-lg border p-6">
          <div className="bg-muted mb-4 h-6 w-48 rounded" />
          <div className="space-y-4">
            <div className="bg-muted h-10 w-full rounded" />
            <div className="bg-muted h-10 w-full rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default withI18n(NewFilmProjectPage);

