import 'server-only';

import { NextRequest, NextResponse } from 'next/server';

import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@kit/supabase/database';

import { CONNECT_FAILURE_LANDING } from './connect-failure';
import { appOrigin } from './fail-connect';

type Client = SupabaseClient<Database>;

/**
 * The account a connect route connects to, from `?accountId=<uuid>` or
 * `?account=<slug>` — the settings page sends the slug. One lookup for every
 * platform: X reads only `accountId`, so the page's Connect
 * button could not have reached them (KB-86).
 *
 * The slug is resolved as the signed-in user, so it only finds an account
 * that person can see.
 */
export async function resolveConnectAccount(
  request: NextRequest,
  client: Client,
): Promise<
  { accountId: string } | { error: 'missing' | 'not_found'; slug?: string }
> {
  const accountId = request.nextUrl.searchParams.get('accountId');

  if (accountId) {
    return { accountId };
  }

  const slug = request.nextUrl.searchParams.get('account');

  if (!slug) {
    return { error: 'missing' };
  }

  const { data } = await client
    .from('accounts')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();

  return data ? { accountId: data.id } : { error: 'not_found', slug };
}

/** The connect route's answer when `resolveConnectAccount` found none. */
export function connectAccountError(error: 'missing' | 'not_found') {
  return error === 'missing'
    ? NextResponse.json({ error: 'Account ID required' }, { status: 400 })
    : NextResponse.json({ error: 'Account not found' }, { status: 404 });
}

/**
 * An absolute URL on the account's platforms page, on the configured origin
 * (KB-87). TikTok and X redirected to the relative
 * `/settings/platforms`, which `NextResponse.redirect` refuses — "URL is
 * malformed … Please use only absolute URLs" — so a connection that had just
 * been saved ended on the "Something broke" failure page.
 *
 * An account without a slug (a personal account) goes to the landing route,
 * which picks a workspace the person belongs to.
 */
export async function platformsPageUrl(
  request: NextRequest,
  client: Client,
  accountId: string,
  subpath = '',
) {
  const { data } = await client
    .from('accounts')
    .select('slug')
    .eq('id', accountId)
    .maybeSingle();

  const path = data?.slug
    ? `/home/${data.slug}/settings/platforms${subpath}`
    : CONNECT_FAILURE_LANDING;

  return new URL(path, appOrigin(request));
}

/** Where a successful connect lands: the platforms page, saying so. */
export async function connectedLanding(
  request: NextRequest,
  client: Client,
  accountId: string,
  success: Record<string, string>,
) {
  const url = await platformsPageUrl(request, client, accountId);

  url.search = new URLSearchParams(success).toString();

  return NextResponse.redirect(url);
}
