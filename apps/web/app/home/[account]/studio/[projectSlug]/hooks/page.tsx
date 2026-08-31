import { notFound } from 'next/navigation';

import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Heading } from '@kit/ui/heading';

import { withI18n } from '~/lib/i18n/with-i18n';

import { HookLabClient } from './_components/hook-lab-client';

export const metadata = {
  title: 'Hook Lab | Film Studio',
  description:
    'Test video openings and compare which hooks hold viewers past three seconds',
};

interface PageProps {
  params: Promise<{ account: string; projectSlug: string }>;
}

async function HookLabPage({ params }: PageProps) {
  const { projectSlug } = await params;
  const client = getSupabaseServerClient();

  const { data: project } = await client
    .from('projects')
    .select('id, account_id')
    .eq('slug', projectSlug)
    .single();

  if (!project) {
    notFound();
  }

  return (
    <div className={'container mx-auto flex flex-col gap-6 py-8'}>
      <div className={'flex flex-col gap-1'}>
        <Heading level={2}>Hook Lab</Heading>
        <p className={'text-muted-foreground text-sm'}>
          Compare openings for the same topic on how many viewers are still
          watching at three seconds. A variant wins by clearing the threshold,
          not merely by beating its siblings.
        </p>
      </div>

      <HookLabClient
        accountId={project.account_id}
        projectId={project.id}
      />
    </div>
  );
}

export default withI18n(HookLabPage);
