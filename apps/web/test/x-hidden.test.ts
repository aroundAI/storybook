import { NextRequest } from 'next/server';

import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * X is retired for now by the owner, 2026-10-02: it is hidden behind
 * `X_ENABLED`, its code kept. Nothing in the app offers it while the switch
 * is off, and switching it on offers it again.
 */

// Off, as shipped; a test switches it on.
const xSwitch = vi.hoisted(() => ({ on: false }));

vi.mock('@kit/publishing/lib/x-switch', () => ({
  get X_ENABLED() {
    return xSwitch.on;
  },
}));

const getUser = vi.hoisted(() => vi.fn(async () => ({ data: { user: null } })));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({ auth: { getUser } }),
}));

afterEach(() => {
  xSwitch.on = false;
  getUser.mockClear();
});

function connectRequest() {
  return new NextRequest(
    'http://localhost:3000/api/platforms/connect/twitter?account=team',
  );
}

describe('connecting X', () => {
  it('answers 404 while X is hidden, before reading who is asking', async () => {
    const { GET } = await import('~/api/platforms/connect/twitter/route');

    const response = await GET(connectRequest());

    expect(response.status).toBe(404);
    expect(getUser).not.toHaveBeenCalled();
  });

  it('starts the connect once X is switched on', async () => {
    xSwitch.on = true;
    const { GET } = await import('~/api/platforms/connect/twitter/route');

    const response = await GET(connectRequest());

    // Signed out, so the first thing it does is send the person to sign in.
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toContain('/auth/sign-in');
    expect(getUser).toHaveBeenCalled();
  });
});

describe('a new project’s target platforms', () => {
  async function targets() {
    vi.resetModules();
    const { OFFERED_TARGET_PLATFORMS } = await import(
      '~/home/[account]/studio/projects/new/_lib/schema'
    );

    return OFFERED_TARGET_PLATFORMS.map(([key]) => key);
  }

  it('do not include X while it is hidden', async () => {
    expect(await targets()).toEqual([
      'youtube',
      'tiktok',
      'instagram',
      'facebook',
      'custom',
    ]);
  });

  it('include X again once it is switched on', async () => {
    xSwitch.on = true;

    expect(await targets()).toContain('twitter');
  });
});
