import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * X is retired for now by the owner, 2026-10-02: the go-to-market platforms
 * are YouTube, Instagram and Facebook. It is hidden behind `X_ENABLED`, not
 * removed, so its code and its kept rows stay, and switching it on brings it
 * back everywhere at once.
 */

async function load(xEnabled?: boolean) {
  vi.resetModules();

  if (xEnabled !== undefined) {
    vi.doMock('../src/lib/x-switch', () => ({ X_ENABLED: xEnabled }));
  }

  const platforms = await import('../src/lib/platforms');
  const constants = await import('../src/lib/constants');

  return { ...platforms, ...constants };
}

afterEach(() => {
  vi.doUnmock('../src/lib/x-switch');
});

describe('X, as shipped', () => {
  it('is switched off', async () => {
    const { X_ENABLED } = await import('../src/lib/x-switch');

    expect(X_ENABLED).toBe(false);
  });

  it('is not offered, though it is still a platform its rows may name', async () => {
    const { OFFERED_PLATFORMS, isOfferedPlatform, isPlatform } = await load();

    expect(OFFERED_PLATFORMS).toEqual([
      'youtube',
      'tiktok',
      'instagram',
      'facebook',
    ]);
    expect(isOfferedPlatform('twitter')).toBe(false);
    expect(isPlatform('twitter')).toBe(true);
  });

  it('takes no video on the publish screen', async () => {
    const { takesVideo } = await load();

    expect(takesVideo('full', 'twitter')).toBe(false);
    expect(takesVideo('short', 'twitter')).toBe(false);
    expect(takesVideo('full', 'youtube')).toBe(true);
  });
});

describe('X, switched on', () => {
  it('is offered again, in its place', async () => {
    const { OFFERED_PLATFORMS, isOfferedPlatform } = await load(true);

    expect(OFFERED_PLATFORMS).toEqual([
      'youtube',
      'tiktok',
      'instagram',
      'facebook',
      'twitter',
    ]);
    expect(isOfferedPlatform('twitter')).toBe(true);
  });

  it('takes full videos and shorts again', async () => {
    const { takesVideo } = await load(true);

    expect(takesVideo('full', 'twitter')).toBe(true);
    expect(takesVideo('short', 'twitter')).toBe(true);
  });
});
