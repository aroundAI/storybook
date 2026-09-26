import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ALL_ANALYTICS_SCOPES_ENABLED } from '../src/oauth/analytics-scope-switch';
import {
  ANALYTICS_SCOPE_REQUIREMENTS,
  REQUESTED_SCOPES,
  parseGrantedScopes,
  parseMetaGrantedPermissions,
  resolveAnalyticsAccess,
  videoSyncAuthorisation,
} from '../src/oauth/analytics-scopes';

const G = 'https://www.googleapis.com/auth/';

/** What the YouTube callback stored for every connection made before FILM-1711. */
const YOUTUBE_LEGACY = [
  `${G}youtube.upload`,
  `${G}youtube.readonly`,
  `${G}youtube.force-ssl`,
  `${G}yt-analytics.readonly`,
];

function states(access: ReturnType<typeof resolveAnalyticsAccess>) {
  return Object.fromEntries(
    (access?.entries ?? []).map((entry) => [entry.requirementId, entry.state]),
  );
}

describe('parseGrantedScopes', () => {
  it('reads a space-delimited grant (Google, X)', () => {
    expect(parseGrantedScopes('tweet.read users.read')).toEqual([
      'tweet.read',
      'users.read',
    ]);
  });

  it('reads a comma-delimited grant (TikTok)', () => {
    expect(parseGrantedScopes('user.info.basic,video.list')).toEqual([
      'user.info.basic',
      'video.list',
    ]);
  });

  it('records nothing when the vendor sent nothing, not what we asked for', () => {
    expect(parseGrantedScopes(undefined)).toEqual([]);
    expect(parseGrantedScopes('')).toEqual([]);
    expect(parseGrantedScopes(['video.list'])).toEqual([]);
  });
});

describe('parseMetaGrantedPermissions', () => {
  it('keeps granted permissions and drops declined and expired ones', () => {
    expect(
      parseMetaGrantedPermissions({
        data: [
          { permission: 'instagram_basic', status: 'granted' },
          { permission: 'instagram_manage_insights', status: 'declined' },
          { permission: 'pages_show_list', status: 'expired' },
        ],
      }),
    ).toEqual(['instagram_basic']);
  });

  it('records nothing for an error body', () => {
    expect(parseMetaGrantedPermissions({ error: { code: 190 } })).toEqual([]);
    expect(parseMetaGrantedPermissions(null)).toEqual([]);
  });
});

describe('resolveAnalyticsAccess', () => {
  it('asks an existing YouTube connection to reconnect for revenue, and only revenue', () => {
    const access = resolveAnalyticsAccess({
      scopesEnabled: ALL_ANALYTICS_SCOPES_ENABLED,
      platform: 'youtube',
      grantedScopes: YOUTUBE_LEGACY,
    });

    expect(states(access)).toEqual({
      'youtube.analytics': 'authorised',
      'youtube.revenue': 'scope_missing',
      'youtube.video-info': 'authorised',
    });
    expect(access?.summary).toBe('not_authorised');
    expect(access?.canReconnect).toBe(true);
  });

  it('is fully authorised once the monetary scope is granted', () => {
    const access = resolveAnalyticsAccess({
      scopesEnabled: ALL_ANALYTICS_SCOPES_ENABLED,
      platform: 'youtube',
      grantedScopes: [...YOUTUBE_LEGACY, `${G}yt-analytics-monetary.readonly`],
    });

    expect(access?.summary).toBe('authorised');
    expect(access?.canReconnect).toBe(false);
  });

  it('tells a missing scope from a channel outside the Partner Program', () => {
    const access = resolveAnalyticsAccess({
      scopesEnabled: ALL_ANALYTICS_SCOPES_ENABLED,
      platform: 'youtube',
      grantedScopes: [...YOUTUBE_LEGACY, `${G}yt-analytics-monetary.readonly`],
      metadata: { analytics_account_gated: ['youtube.revenue'] },
    });

    expect(states(access)['youtube.revenue']).toBe('account_type_gated');
    expect(access?.summary).toBe('not_authorised');
    // The creator resolves this one, and not by reconnecting.
    expect(access?.canReconnect).toBe(false);
    expect(
      access?.entries.find(({ state }) => state === 'account_type_gated')
        ?.resolution,
    ).toMatch(/Partner Program/);
  });

  it('does not read an account gate into a connection that lacks the scope', () => {
    const access = resolveAnalyticsAccess({
      scopesEnabled: ALL_ANALYTICS_SCOPES_ENABLED,
      platform: 'youtube',
      grantedScopes: YOUTUBE_LEGACY,
      metadata: { analytics_account_gated: ['youtube.revenue'] },
    });

    expect(states(access)['youtube.revenue']).toBe('scope_missing');
  });

  it('offers no reconnect while the vendor has not approved the scope', () => {
    const tiktok = resolveAnalyticsAccess({
      scopesEnabled: ALL_ANALYTICS_SCOPES_ENABLED,
      platform: 'tiktok',
      grantedScopes: ['user.info.basic', 'video.upload'],
    });
    const instagram = resolveAnalyticsAccess({
      scopesEnabled: ALL_ANALYTICS_SCOPES_ENABLED,
      platform: 'instagram',
      grantedScopes: ['instagram_basic', 'instagram_content_publish'],
    });

    expect(states(tiktok)).toEqual({
      'tiktok.video-metrics': 'review_pending',
      'tiktok.follower-count': 'review_pending',
    });
    expect(tiktok?.canReconnect).toBe(false);
    expect(states(instagram)['instagram.insights']).toBe('review_pending');
    expect(instagram?.summary).toBe('not_authorised');
  });

  it('needs all three Facebook Login permissions for Instagram insights', () => {
    const access = resolveAnalyticsAccess({
      scopesEnabled: ALL_ANALYTICS_SCOPES_ENABLED,
      platform: 'instagram',
      grantedScopes: ['instagram_basic', 'instagram_manage_insights'],
    });

    expect(
      access?.entries.find(
        ({ requirementId }) => requirementId === 'instagram.insights',
      )?.missingScopes,
    ).toEqual(['pages_read_engagement']);
  });

  it('reports no recorded grant as unknown, never as missing', () => {
    for (const grantedScopes of [null, undefined, []]) {
      const access = resolveAnalyticsAccess({
        scopesEnabled: ALL_ANALYTICS_SCOPES_ENABLED,
        platform: 'youtube',
        grantedScopes,
      });

      expect(access?.summary).toBe('unknown');
      expect(access?.entries.every(({ state }) => state === 'unknown')).toBe(
        true,
      );
    }
  });

  it('says a platform has no provider rather than that it is unauthorised', () => {
    expect(
      resolveAnalyticsAccess({
        scopesEnabled: ALL_ANALYTICS_SCOPES_ENABLED,
        platform: 'facebook',
        grantedScopes: ['pages_show_list'],
      }),
    ).toMatchObject({
      summary: 'no_provider',
      canReconnect: false,
      entries: [{ state: 'no_provider', plannedIn: 'FILM-1720' }],
    });
  });

  it('has nothing to say about a platform with no analytics requirement', () => {
    expect(
      resolveAnalyticsAccess({
        scopesEnabled: ALL_ANALYTICS_SCOPES_ENABLED,
        platform: 'linkedin',
        grantedScopes: [],
      }),
    ).toBeNull();
  });
});

describe('videoSyncAuthorisation', () => {
  it('does not let missing revenue stop the YouTube sync', () => {
    expect(
      videoSyncAuthorisation({
        platform: 'youtube',
        grantedScopes: YOUTUBE_LEGACY,
      }),
    ).toBe('authorised');
  });

  it('refuses a platform it has no requirement for', () => {
    expect(
      videoSyncAuthorisation({ platform: 'facebook', grantedScopes: ['x'] }),
    ).toBe('not_authorised');
  });
});

describe('the OAuth callbacks record the grant, not the request', () => {
  // The five analytics platforms' callbacks. LinkedIn is absent: nothing reads
  // its grant, and it still stores the list it asked for.
  const ROUTES = [
    'callback/youtube/route.ts',
    'youtube/save-channel/route.ts',
    'callback/meta/route.ts',
    'callback/tiktok/route.ts',
    'callback/twitter/route.ts',
  ];

  it.each(ROUTES)('%s', (route) => {
    const source = readFileSync(
      resolve(__dirname, '../../../../apps/web/app/api/platforms', route),
      'utf8',
    );

    const stored = [...source.matchAll(/^\s*scopes:\s*(.*)$/gm)].map(
      ([, value]) => value!,
    );

    expect(stored.length).toBeGreaterThan(0);
    // A requested list stored as `scopes` claims a grant nobody confirmed.
    // Once FILM-1711 added the analytics scopes to the configs, that claim
    // would have marked every connection authorised.
    expect(stored.filter((value) => /OAUTH_CONFIG|\['/.test(value))).toEqual(
      [],
    );
    expect(source).toContain('scopes_granted_at');
  });
});

describe('the declaration', () => {
  it('requests every scope of every implemented requirement', () => {
    const gaps = ANALYTICS_SCOPE_REQUIREMENTS.filter(
      ({ provider }) => provider === 'implemented',
    ).flatMap(({ id, platform, scopes }) =>
      scopes
        .filter((scope) => !REQUESTED_SCOPES[platform].includes(scope))
        .map((scope) => `${id}: ${scope}`),
    );

    expect(gaps).toEqual([]);
  });

  it('gives every requirement a sentence a creator can read, and a source', () => {
    for (const requirement of ANALYTICS_SCOPE_REQUIREMENTS) {
      expect(requirement.gains.length).toBeGreaterThan(10);
      expect(requirement.source).toMatch(/^(https:\/\/|docs\/)/);
    }
  });

  // `review` decides whether creators are prompted to reconnect, and the
  // tracker is what a person updates when a vendor answers. One without the
  // other is a prompt nobody can satisfy, or an approval nobody acts on.
  it('agrees with docs/vendor-review-status.md about every vendor review', () => {
    const tracker = readFileSync(
      resolve(__dirname, '../../../../docs/vendor-review-status.md'),
      'utf8',
    );

    const rows = tracker
      .split('\n')
      .filter((line) => line.startsWith('| ') && !line.startsWith('| Vendor'))
      .map((line) => line.split('|').map((cell) => cell.trim()))
      .map((cells) => ({
        scopes: [...cells[3]!.matchAll(/`([^`]+)`/g)].map(([, scope]) => scope),
        review: /`([^`]+)`/.exec(cells[7]!)?.[1],
      }))
      .filter((row) => row.review !== undefined);

    expect(rows.length).toBeGreaterThanOrEqual(4);

    const disagreements = ANALYTICS_SCOPE_REQUIREMENTS.flatMap((requirement) =>
      rows
        .filter((row) =>
          requirement.scopes.some((scope) =>
            row.scopes.includes(scope.split('/').pop()!),
          ),
        )
        .filter((row) => row.review !== requirement.review)
        .map(
          (row) =>
            `${requirement.id}: code says ${requirement.review}, the tracker says ${row.review}`,
        ),
    );

    expect(disagreements).toEqual([]);
  });
});
