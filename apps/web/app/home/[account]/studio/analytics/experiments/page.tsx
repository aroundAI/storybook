import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { createTeamAccountsApi } from '@kit/team-accounts/api';
import { Heading } from '@kit/ui/heading';

import { withI18n } from '~/lib/i18n/with-i18n';

import { ExperimentsClient } from './_components/experiments-client';

export const metadata = {
  title: 'Change Log | Film Studio',
  description:
    'Record a change to published videos, what you expected, and what happened',
};

interface PageProps {
  params: Promise<{ account: string }>;
}

async function ExperimentsPage({ params }: PageProps) {
  const { account } = await params;

  const client = getSupabaseServerClient();
  const api = createTeamAccountsApi(client);
  const accountData = await api.getTeamAccount(account);

  if (!accountData) {
    return (
      <div className={'container mx-auto py-8'}>
        <div className={'text-center'}>
          <Heading level={2}>Account not found</Heading>
          <p className={'text-muted-foreground mt-2'}>
            The requested account could not be found.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={'container mx-auto flex flex-col gap-6 py-8'}>
      <div className={'flex flex-col gap-1'}>
        <Heading level={2}>Change log</Heading>
        <p className={'text-muted-foreground text-sm'}>
          Record a change to published videos, usually a new thumbnail or title,
          and see those videos before and after it. Each video is compared with
          its own past.
        </p>
      </div>

      <ExperimentsClient accountId={accountData.id} />
    </div>
  );
}

export default withI18n(ExperimentsPage);
