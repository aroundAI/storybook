import { readFileSync, readdirSync } from 'node:fs';
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

describe('the X connect route', () => {
  // FILM-1729: /2/media/upload is refused without media.write.
  it('requests media.write alongside the posting scopes', () => {
    expect(REQUESTED_SCOPES.twitter).toEqual([
      'tweet.read',
      'tweet.write',
      'media.write',
      'users.read',
      'offline.access',
    ]);
  });
});

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

  it('reads X through its own scopes now that it has a provider (FILM-1727)', () => {
    // X was the last platform with `no_provider`; every requirement is now
    // implemented, so that state has no live instance.
    expect(
      resolveAnalyticsAccess({
        scopesEnabled: ALL_ANALYTICS_SCOPES_ENABLED,
        platform: 'twitter',
        grantedScopes: ['tweet.read', 'users.read'],
      }),
    ).toMatchObject({
      summary: 'authorised',
      entries: [{ requirementId: 'x.post-analytics', state: 'authorised' }],
    });
    expect(
      resolveAnalyticsAccess({
        scopesEnabled: ALL_ANALYTICS_SCOPES_ENABLED,
        platform: 'twitter',
        grantedScopes: ['tweet.read'],
      })?.summary,
    ).toBe('not_authorised');
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
      videoSyncAuthorisation({ platform: 'twitter', grantedScopes: ['x'] }),
    ).toBe('not_authorised');
  });

  it('syncs a Facebook video only once read_insights is held (FILM-1720)', () => {
    const publishing = [
      'pages_show_list',
      'pages_read_engagement',
      'pages_manage_posts',
    ];

    expect(
      videoSyncAuthorisation({
        platform: 'facebook',
        grantedScopes: publishing,
      }),
    ).toBe('not_authorised');
    expect(
      videoSyncAuthorisation({
        platform: 'facebook',
        grantedScopes: [
          ...publishing,
          'read_insights',
          'pages_manage_engagement',
        ],
      }),
    ).toBe('authorised');
  });
});

describe('the OAuth callbacks record the grant, not the request', () => {
  // Every file that stores a connection, read from disk so a new writer
  // cannot be left out (KB-145: LinkedIn's callback was, and stored the list
  // it asked for). storePlatformConnections is the one way a connection is
  // written (KB-43), so its callers are every place `scopes` is set — the
  // callbacks and the YouTube channel picker that finishes YouTube's connect.
  const WEB = resolve(__dirname, '../../../../apps/web');
  const PLATFORMS = resolve(WEB, 'app/api/platforms');

  const ROUTES = ['app', 'lib']
    .flatMap((dir) =>
      readdirSync(resolve(WEB, dir), { recursive: true, encoding: 'utf8' })
        .filter((file) => /\.tsx?$/.test(file) && !/__tests__/.test(file))
        .map((file) => `${dir}/${file}`),
    )
    .filter((file) =>
      readFileSync(resolve(WEB, file), 'utf8').includes(
        'storePlatformConnections(',
      ),
    )
    .filter((file) => !file.endsWith('platforms/store-connection.ts'))
    .sort();

  it('covers every platform callback', () => {
    const callbacks = readdirSync(resolve(PLATFORMS, 'callback')).map(
      (platform) => `app/api/platforms/callback/${platform}/route.ts`,
    );

    expect(callbacks).toEqual(
      expect.arrayContaining([
        'app/api/platforms/callback/linkedin/route.ts',
        'app/api/platforms/callback/meta/route.ts',
        'app/api/platforms/callback/tiktok/route.ts',
        'app/api/platforms/callback/twitter/route.ts',
        'app/api/platforms/callback/youtube/route.ts',
      ]),
    );
    // A callback that stores its connection some other way escapes the
    // check below, so every callback must be one of the writers it reads.
    expect(ROUTES).toEqual(expect.arrayContaining(callbacks));
    expect(ROUTES).toContain('app/api/platforms/youtube/save-channel/route.ts');
  });

  it.each(ROUTES)('%s', (route) => {
    const source = readFileSync(resolve(WEB, route), 'utf8');

    // Stored values only: a `scopes: string[];` line is a type.
    const stored = [...source.matchAll(/^\s*scopes:\s*(.*)$/gm)]
      .map(([, value]) => value!)
      .filter((value) => !/^string\[\];?$/.test(value));

    expect(stored.length).toBeGreaterThan(0);
    // A requested list stored as `scopes` claims a grant nobody confirmed.
    // Once FILM-1711 added the analytics scopes to the configs, that claim
    // would have marked every connection authorised. Every stored value must
    // come from what the vendor said it granted.
    expect(
      stored.filter(
        (value) => !/parseGrantedScopes\(|grantedScopes\b/.test(value),
      ),
    ).toEqual([]);
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

  it('names what each requirement adds, not a sentence another one shares', () => {
    // The reconnect prompt lists `gains`. One copied from another platform,
    // or a generic "analytics", tells a creator nothing about this one.
    const gains = ANALYTICS_SCOPE_REQUIREMENTS.map(({ gains }) => gains);

    expect(new Set(gains).size).toBe(gains.length);
    expect(
      gains.filter((gain) => /^(your )?analytics\.?$/i.test(gain)),
    ).toEqual([]);
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
