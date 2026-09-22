import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';

import { decrypt, encrypt } from '@kit/shared/crypto';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

interface PendingConnection {
  accountId: string;
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  /** Absent on a cookie written before FILM-1711; recorded as no grant. */
  grantedScopes?: string[];
  channels: Array<{
    id: string;
    title: string;
    thumbnailUrl?: string;
    subscriberCount?: string;
  }>;
  returnUrl: string;
  nonce: string;
}

/**
 * Save the selected YouTube channel from the channel picker
 */
export async function POST(request: NextRequest) {
  const logger = await getLogger();
  const ctx = { name: 'youtube.save-channel' };

  const client = getSupabaseServerClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get the pending connection from cookie
  const cookieStore = await cookies();
  const pendingCookie = cookieStore.get('youtube_pending_connection');

  if (!pendingCookie?.value) {
    return NextResponse.json(
      { error: 'No pending connection found. Please try connecting again.' },
      { status: 400 },
    );
  }

  let pendingConnection: PendingConnection;
  try {
    const decrypted = await decrypt(pendingCookie.value);
    pendingConnection = JSON.parse(decrypted);
  } catch {
    return NextResponse.json(
      { error: 'Invalid pending connection. Please try again.' },
      { status: 400 },
    );
  }

  // Get selected channel ID from request body
  const body = await request.json();
  const { channelId } = body;

  if (!channelId) {
    return NextResponse.json(
      { error: 'Channel ID is required' },
      { status: 400 },
    );
  }

  // Find the selected channel in the pending connection
  const selectedChannel = pendingConnection.channels.find(
    (ch) => ch.id === channelId,
  );

  if (!selectedChannel) {
    return NextResponse.json(
      { error: 'Selected channel not found' },
      { status: 400 },
    );
  }

  // Encrypt tokens before storage
  const encryptedAccessToken = await encrypt(pendingConnection.accessToken);
  const encryptedRefreshToken = pendingConnection.refreshToken
    ? await encrypt(pendingConnection.refreshToken)
    : null;

  // Store the connection
  const { error: insertError } = await client
    .from('platform_connections')
    .upsert(
      {
        account_id: pendingConnection.accountId,
        platform: 'youtube',
        platform_account_id: selectedChannel.id,
        platform_account_name: selectedChannel.title,
        access_token_encrypted: encryptedAccessToken,
        refresh_token_encrypted: encryptedRefreshToken,
        token_expires_at: new Date(
          Date.now() + pendingConnection.expiresIn * 1000,
        ).toISOString(),
        scopes: pendingConnection.grantedScopes ?? [],
        metadata: {
          scopes_granted_at: new Date().toISOString(),
          thumbnail_url: selectedChannel.thumbnailUrl,
          // No subscriber_count. It was written here and read nowhere — a
          // level captured once, at a date nobody recorded, then left to
          // rot. FILM-1607 stores the dated series in ClickHouse instead.
        },
        is_active: true,
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: 'account_id,platform,platform_account_id',
      },
    );

  if (insertError) {
    logger.error({ ...ctx, error: insertError }, 'Failed to store connection');
    return NextResponse.json(
      { error: 'Failed to save connection' },
      { status: 500 },
    );
  }

  // Clean up the OAuth state
  const { error: deleteError } = await client
    .from('oauth_states')
    .delete()
    .eq('nonce', pendingConnection.nonce);

  if (deleteError) {
    logger.warn(
      { ...ctx, error: deleteError },
      'Failed to cleanup OAuth state',
    );
  }

  // Clear the pending connection cookie
  const response = NextResponse.json({
    success: true,
    channelId: selectedChannel.id,
    channelName: selectedChannel.title,
  });

  response.cookies.delete('youtube_pending_connection');

  return response;
}
