import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { restoreSocialState, saveSocialState } from '../src/social/persist';
import { PLATFORMS } from '../src/social/profile';
import { SocialState } from '../src/social/state';

/**
 * FILM-1802 criterion 8 (two runs differ; the same SANDBOX_SEED reproduces a
 * run) and the token model the vendor PRs build on.
 */

const T0 = Date.parse('2026-09-25T09:00:00Z');
const HOUR = 3_600_000;

/** A run: two accounts and three objects per platform, and their figures a day later. */
function run(seed: number, order: 'forward' | 'reverse' = 'forward') {
  let now = T0;
  const social = new SocialState({ seed, now: () => now });
  const platforms =
    order === 'forward' ? [...PLATFORMS] : [...PLATFORMS].reverse();

  const byPlatform = Object.fromEntries(
    platforms.map((platform) => {
      const accounts = [
        social.createAccount(platform),
        social.createAccount(platform),
      ];
      const objects = [0, 1, 2].map(() =>
        social.createObject(platform, accounts[0]!.id),
      );
      return [platform, { accounts, objects }];
    }),
  );

  now = T0 + 24 * HOUR;
  return Object.fromEntries(
    PLATFORMS.map((platform) => {
      const { accounts, objects } = byPlatform[platform]!;
      return [
        platform,
        {
          accounts: accounts.map((a) => [
            a.id,
            a.name,
            a.handle,
            social.followers(a),
          ]),
          objects: objects.map((o) => [
            o.id,
            o.title,
            o.profile.archetype,
            social.cumulative(o, 'views'),
            social.cumulative(o, 'likes'),
          ]),
        },
      ];
    }),
  );
}

describe('seed', () => {
  it('the same seed reproduces a run exactly', () => {
    expect(run(424242)).toEqual(run(424242));
  });

  it('the same seed reproduces a run whatever order the platforms were asked in', () => {
    expect(run(424242, 'reverse')).toEqual(run(424242));
  });

  it('two seeds give different runs', () => {
    const a = run(1);
    const b = run(2);
    for (const platform of PLATFORMS) {
      expect(a[platform]).not.toEqual(b[platform]);
    }
  });

  it('an adopted id gets the same profile every time it is asked about in a run', () => {
    const social = new SocialState({ seed: 99, now: () => T0 });
    const first = social.object('tiktok', '7391827365012345678');
    const again = social.object('tiktok', '7391827365012345678');
    expect(again).toBe(first);
    expect(first.adopted).toBe(true);

    const other = new SocialState({ seed: 99, now: () => T0 });
    expect(other.object('tiktok', '7391827365012345678').profile).toEqual(
      first.profile,
    );
  });

  it('a reset starts a new run under the new seed', () => {
    const social = new SocialState({ seed: 5, now: () => T0 });
    social.createAccount('youtube');
    social.reset(6);
    expect(social.seed).toBe(6);
    expect(social.listAccounts()).toEqual([]);
  });
});

describe('tokens', () => {
  it('an access token works for the scopes it was granted, and refuses the rest by name', () => {
    const social = new SocialState({ seed: 1, now: () => T0 });
    const account = social.createAccount('tiktok');
    const { access } = social.issueTokens('tiktok', account.id, [
      'user.info.basic',
      'video.publish',
    ]);

    expect(social.checkToken(access.value, ['video.publish'])).toMatchObject({
      ok: true,
    });
    expect(
      social.checkToken(access.value, ['video.list', 'video.publish']),
    ).toEqual({
      ok: false,
      reason: 'scope',
      missing: ['video.list'],
    });
  });

  it('expires in real time; a refresh token does not', () => {
    let now = T0;
    const social = new SocialState({ seed: 1, speed: 86_400, now: () => now });
    const account = social.createAccount('youtube');
    const { access, refresh } = social.issueTokens('youtube', account.id, [], {
      ttlMs: HOUR,
    });

    now = T0 + HOUR - 1;
    expect(social.checkToken(access.value).ok).toBe(true);
    now = T0 + HOUR;
    expect(social.checkToken(access.value)).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(social.checkToken(refresh!.value).ok).toBe(true);
  });

  it("revoking any token of a grant revokes all of that account's tokens on that platform", () => {
    const social = new SocialState({ seed: 1, now: () => T0 });
    const account = social.createAccount('x');
    const first = social.issueTokens('x', account.id, ['tweet.read']);
    const second = social.issueTokens('x', account.id, ['tweet.read']);
    const elsewhere = social.issueTokens(
      'tiktok',
      social.createAccount('tiktok').id,
      [],
    );

    expect(social.revoke(first.access.value)).toBe(true);
    expect(social.checkToken(second.refresh!.value)).toEqual({
      ok: false,
      reason: 'revoked',
    });
    expect(social.checkToken(elsewhere.access.value).ok).toBe(true);
    expect(social.checkToken('sbx.x.never-issued')).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });
});

describe('SANDBOX_PERSIST', () => {
  it('state saved and restored is the same state', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'sandbox-')), 'state.json');
    const social = new SocialState({ seed: 31, now: () => T0 });
    const account = social.createAccount('instagram');
    social.createObject('instagram', account.id);
    social.issueTokens('instagram', account.id, ['instagram_basic']);
    saveSocialState(social, file);

    const restored = new SocialState({ seed: 1, now: () => T0 });
    expect(restoreSocialState(restored, file)).toBe(true);
    expect(restored.toJSON()).toEqual(social.toJSON());
    // And a new object after restore continues the run, not a copy of the first.
    expect(restored.createObject('instagram', account.id).id).not.toBe(
      social.listObjects('instagram')[0]!.id,
    );
  });

  it('with nothing saved, nothing is restored', () => {
    const social = new SocialState({ seed: 31 });
    expect(
      restoreSocialState(social, join(tmpdir(), 'no-such-sandbox-state.json')),
    ).toBe(false);
  });
});
