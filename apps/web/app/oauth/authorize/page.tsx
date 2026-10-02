import Link from 'next/link';
import { redirect } from 'next/navigation';

import { parseAuthorizeRequest } from '@kit/studio-mcp/server';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { Button } from '@kit/ui/button';

import { createI18nServerInstance } from '~/lib/i18n/i18n.server';
import { withI18n } from '~/lib/i18n/with-i18n';

import { oauthDeps } from '../_lib/server/oauth-route';
import { AuthorizeError } from './_components/authorize-error';
import { ConsentForm } from './_components/consent-form';

/**
 * `GET /oauth/authorize` (FILM-1907): the consent page.
 *
 * A signed-out user goes through the normal sign-in, MFA included, with
 * `next` carrying this request back here intact (`requireUser` with the
 * web's own redirect rules). The request is validated before anything is
 * shown: a client or redirect URI we cannot trust is an error on this page
 * and never a redirect; any other problem goes back to the client as an
 * OAuth error response.
 */
export const dynamic = 'force-dynamic';

export const generateMetadata = async () => {
  const i18n = await createI18nServerInstance();

  return { title: i18n.t('auth:signIn') };
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function AuthorizePage(props: PageProps) {
  const params = toSearchParams(await props.searchParams);
  const query = params.toString();
  const client = getSupabaseServerClient();

  const auth = await requireUser(client, {
    next: encodeURIComponent(`/oauth/authorize?${query}`),
  });

  if (auth.error) {
    redirect(auth.redirectTo);
  }

  const parsed = await parseAuthorizeRequest(params, oauthDeps());

  if (!parsed.ok) {
    if (parsed.kind === 'redirect') {
      redirect(parsed.location);
    }

    return (
      <AuthorizeError
        code={parsed.error.code}
        description={parsed.error.message}
      />
    );
  }

  const { data: teams, error } = await client
    .from('user_accounts')
    .select('id, name, slug')
    .order('name');

  if (error) {
    throw new Error(`could not list the user's teams: ${error.message}`);
  }

  const memberships = (teams ?? []).flatMap((team) =>
    team.id && team.name && team.slug
      ? [{ id: team.id, name: team.name, slug: team.slug }]
      : [],
  );

  if (memberships.length === 0) {
    return (
      <Alert data-test="oauth-consent-no-teams">
        <AlertTitle>Create a team first</AlertTitle>
        <AlertDescription className="space-y-3">
          <p>
            {parsed.request.client.clientName} connects to one of your teams,
            and you are not a member of any yet.
          </p>
          <Button asChild size="sm">
            <Link href="/home/teams/create">Create a team</Link>
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <ConsentForm
      query={query}
      clientName={parsed.request.client.clientName}
      clientId={parsed.request.client.clientId}
      metadataUrl={parsed.request.client.metadataUrl}
      redirectHost={new URL(parsed.request.redirectUri).host || parsed.request.redirectUri}
      scopes={parsed.request.scopes}
      teams={memberships}
      userEmail={auth.data.email ?? null}
    />
  );
}

function toSearchParams(raw: Record<string, string | string[] | undefined>) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(raw)) {
    const first = Array.isArray(value) ? value[0] : value;

    if (typeof first === 'string') params.set(key, first);
  }

  return params;
}

export default withI18n(AuthorizePage);
