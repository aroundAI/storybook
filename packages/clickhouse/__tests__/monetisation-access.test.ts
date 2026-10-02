import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ANALYTICS_PLATFORMS,
  CAPABILITY_MATRIX,
} from '../src/lib/data-provenance';
import {
  CONNECTION_REVENUE_STATES,
  monetisationAccess,
} from '../src/lib/monetisation-access';

/**
 * FILM-1726 criterion 3: for revenue, "not in the Partner Program", "we
 * never asked for the scope" and "the platform has no revenue API" are three
 * different sentences with three different owners. Collapsing any two tells
 * a creator to do something that cannot help.
 */
const REPO = resolve(import.meta.dirname, '../../..');

describe('monetisationAccess', () => {
  it('says the platform’s, the creator’s and ours apart', () => {
    const platform = monetisationAccess('tiktok', { revenue: null });
    const creator = monetisationAccess('youtube', {
      revenue: 'account_type_gated',
    });
    const ours = monetisationAccess('youtube', { revenue: 'scope_missing' });

    expect(platform).toMatchObject({ state: 'unsupported', owner: 'platform' });
    expect(creator).toMatchObject({
      state: 'account_type_gated',
      owner: 'creator',
    });
    expect(ours).toMatchObject({
      state: 'scope_missing',
      owner: 'us',
      reconnect: true,
    });
    expect(new Set([platform.note, creator.note, ours.note]).size).toBe(3);
  });

  it('is unsupported on TikTok and Instagram whatever the connection says', () => {
    for (const platform of ['tiktok', 'instagram'] as const) {
      for (const revenue of [null, ...CONNECTION_REVENUE_STATES]) {
        expect(
          monetisationAccess(platform, { revenue }).state,
          `${platform} · ${revenue}`,
        ).toBe('unsupported');
      }
    }
  });

  it('names YouTube Partner Program membership to a creator outside it', () => {
    const gated = monetisationAccess('youtube', {
      revenue: 'account_type_gated',
    });

    expect(gated.note).toBe(
      CAPABILITY_MATRIX.revenue.youtube.accountGate?.note,
    );
    expect(gated.reconnect).toBe(false);
  });

  it('offers a reconnect only where reconnecting would grant something', () => {
    const offered = ANALYTICS_PLATFORMS.flatMap((platform) =>
      [null, ...CONNECTION_REVENUE_STATES]
        .filter(
          (revenue) => monetisationAccess(platform, { revenue }).reconnect,
        )
        .map((revenue) => `${platform} · ${revenue}`),
    );

    expect(offered).toEqual(['youtube · scope_missing']);
  });

  it('does not offer a reconnect when our request leaves the scope out', () => {
    expect(
      monetisationAccess('youtube', { revenue: 'not_requested' }),
    ).toMatchObject({ state: 'not_requested', owner: 'us', reconnect: false });
  });

  it('reads Facebook as waiting on Meta’s review until a Page grant is recorded', () => {
    expect(monetisationAccess('facebook', { revenue: null })).toMatchObject({
      state: 'review_required',
      owner: 'us',
      reconnect: false,
    });
    expect(
      monetisationAccess('facebook', { revenue: 'account_type_gated' }),
    ).toMatchObject({ state: 'account_type_gated', owner: 'creator' });
  });

  it('falls back to our configuration when a connection has no recorded grant', () => {
    expect(monetisationAccess('youtube', { revenue: 'unknown' })).toMatchObject(
      { state: 'authorised', owner: null },
    );
    expect(monetisationAccess('youtube', { revenue: null })).toMatchObject({
      state: 'authorised',
      owner: null,
    });
  });

  it('takes the per-connection states publishing resolves, and no others', () => {
    // `resolveAnalyticsAccess` (publishing) answers per connection; this
    // package cannot import it, so the union is read from its source.
    const source = readFileSync(
      join(REPO, 'packages/features/publishing/src/oauth/analytics-scopes.ts'),
      'utf8',
    );
    const union = /export type AnalyticsAccessState =([^;]+);/.exec(
      source,
    )?.[1];
    const members = [...union!.matchAll(/'([^']+)'/g)]
      .map(([, name]) => name)
      .filter((name) => name !== 'no_provider');

    expect([...CONNECTION_REVENUE_STATES].sort()).toEqual(members.sort());
  });
});
