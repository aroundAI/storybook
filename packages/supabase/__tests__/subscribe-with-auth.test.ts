import { describe, expect, it, vi } from 'vitest';

import { subscribeWithAuth } from '../src/realtime/subscribe-with-auth';

/**
 * KB-181. A channel joined before the socket carries the user's token joins
 * as `anon`, and Realtime then drops every row the table's RLS hides.
 */
function fakeClient(session: { access_token: string } | null) {
  const calls: string[] = [];
  let authListener: ((event: string, session: unknown) => void) | undefined;
  const unsubscribeAuth = vi.fn();

  const channel = {
    subscribe: vi.fn(() => {
      calls.push('subscribe');

      return channel;
    }),
  };

  const client = {
    auth: {
      getSession: vi.fn(async () => ({ data: { session } })),
      onAuthStateChange: vi.fn((listener: typeof authListener) => {
        authListener = listener;

        return { data: { subscription: { unsubscribe: unsubscribeAuth } } };
      }),
    },
    realtime: {
      setAuth: vi.fn(async (token: string | null) => {
        calls.push(`setAuth:${token}`);
      }),
    },
    removeChannel: vi.fn(async () => 'ok'),
  };

  return {
    client,
    channel,
    calls,
    unsubscribeAuth,
    emitAuth: (next: { access_token: string } | null) =>
      authListener?.('TOKEN_REFRESHED', next),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('subscribeWithAuth', () => {
  it('sets the access token on the socket before the channel joins', async () => {
    const fake = fakeClient({ access_token: 'jwt-1' });

    subscribeWithAuth(fake.client as never, () => fake.channel as never);
    await flush();

    expect(fake.calls).toEqual(['setAuth:jwt-1', 'subscribe']);
  });

  it('sets the new token when the session changes', async () => {
    const fake = fakeClient({ access_token: 'jwt-1' });

    subscribeWithAuth(fake.client as never, () => fake.channel as never);
    await flush();
    fake.emitAuth({ access_token: 'jwt-2' });

    expect(fake.calls).toContain('setAuth:jwt-2');
  });

  it('never joins when cleaned up before the token is set', async () => {
    const fake = fakeClient({ access_token: 'jwt-1' });

    const cleanup = subscribeWithAuth(
      fake.client as never,
      () => fake.channel as never,
    );
    cleanup();
    await flush();

    expect(fake.channel.subscribe).not.toHaveBeenCalled();
    expect(fake.unsubscribeAuth).toHaveBeenCalledTimes(1);
  });

  it('removes the channel on cleanup', async () => {
    const fake = fakeClient({ access_token: 'jwt-1' });

    const cleanup = subscribeWithAuth(
      fake.client as never,
      () => fake.channel as never,
    );
    await flush();
    cleanup();

    expect(fake.client.removeChannel).toHaveBeenCalledWith(fake.channel);
  });
});
