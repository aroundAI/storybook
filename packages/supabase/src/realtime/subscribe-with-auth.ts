import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

/**
 * Joins a Realtime channel as the signed-in user.
 *
 * A channel joined before the socket carries the user's access token joins
 * as `anon`. Realtime then evaluates the table's RLS with no user and drops
 * every `postgres_changes` event while the channel still reports
 * `SUBSCRIBED` (KB-181). The token is set first, and again whenever the
 * session changes.
 *
 * Returns the cleanup that removes the channel.
 */
export function subscribeWithAuth<Db>(
  client: SupabaseClient<Db>,
  buildChannel: (client: SupabaseClient<Db>) => RealtimeChannel,
): () => void {
  let channel: RealtimeChannel | undefined;
  let cancelled = false;

  const { data: listener } = client.auth.onAuthStateChange(
    (_event, session) => {
      void client.realtime.setAuth(session?.access_token ?? null);
    },
  );

  void client.auth.getSession().then(async ({ data }) => {
    if (cancelled) {
      return;
    }

    await client.realtime.setAuth(data.session?.access_token ?? null);

    if (cancelled) {
      return;
    }

    channel = buildChannel(client).subscribe();
  });

  return () => {
    cancelled = true;
    listener.subscription.unsubscribe();

    if (channel) {
      void client.removeChannel(channel);
    }
  };
}
