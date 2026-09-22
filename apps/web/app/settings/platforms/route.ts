import { NextRequest, NextResponse } from 'next/server';

import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  chooseAccountSlug,
  connectFailurePath,
  connectFailureQuery,
  readConnectFailure,
} from '~/lib/platforms/connect-failure';
import { appOrigin } from '~/lib/platforms/fail-connect';

/**
 * Where a failed platform connect lands when the callback does not know the
 * account's slug (KB-19) — which is most failures, because the slug is looked
 * up from an OAuth state that may be the very thing that failed.
 *
 * Chooses the account as the signed-in user, so a crafted `account` can only
 * ever name a workspace that person already belongs to, and sends them to its
 * platforms page with the failure re-written from what `readConnectFailure`
 * recognised. Nothing else in the query string is carried over.
 */
export async function GET(request: NextRequest) {
  const client = getSupabaseServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL('/auth/sign-in', request.url));
  }

  const params = Object.fromEntries(request.nextUrl.searchParams);
  const failure = readConnectFailure(params);

  const { data: teams } = await client
    .from('user_accounts')
    .select('id, slug')
    .order('slug')
    .limit(50);

  const target = new URL(
    connectFailurePath(chooseAccountSlug(teams ?? [], params.account)),
    appOrigin(request),
  );

  if (failure) {
    target.search = connectFailureQuery(failure).toString();
  }

  return NextResponse.redirect(target);
}
