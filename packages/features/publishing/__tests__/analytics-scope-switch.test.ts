import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ALL_ANALYTICS_SCOPES_ENABLED,
  ANALYTICS_ADDED_SCOPES,
  NO_ANALYTICS_SCOPES_ENABLED,
  connectScopes,
  parseAnalyticsScopesEnabled,
} from '../src/oauth/analytics-scope-switch';
import {
  ANALYTICS_SCOPE_REQUIREMENTS,
  REQUESTED_SCOPES,
  resolveAnalyticsAccess,
} from '../src/oauth/analytics-scopes';
import { META_OAUTH_CONFIG } from '../src/oauth/meta/config';
import { TIKTOK_OAUTH_CONFIG } from '../src/oauth/tiktok/config';
import { YOUTUBE_OAUTH_CONFIG } from '../src/oauth/youtube/config';

/**
 * FILM-1711 shipped the new analytics scopes in every connect request with no
 * way to hold one platform back. If a vendor rejects an authorise request that
 * names a scope it has not approved, connecting — and publishing — breaks for
 * that platform, and the only remedy was not deploying at all.
 * ANALYTICS_SCOPES_ENABLED names the platforms whose requests carry them.
 * Unset is none: the request production made before FILM-1711.
 */

const G = 'https://www.googleapis.com/auth/';

/** What each connect route asked for before #289 (git show d8c635c1). */
const BEFORE_1711 = {
  youtube: [
    `${G}youtube.upload`,
    `${G}youtube.readonly`,
    `${G}youtube.force-ssl`,
    `${G}yt-analytics.readonly`,
  ],
  // video.publish is KB-143's, not FILM-1711's: it stays in the request with every analytics scope off.
  tiktok: ['user.info.basic', 'video.upload', 'video.publish'],
  meta: [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
    'instagram_basic',
    'instagram_content_publish',
    'business_management',
  ],
};

const CONFIG = {
  youtube: YOUTUBE_OAUTH_CONFIG.scopes,
  tiktok: TIKTOK_OAUTH_CONFIG.scopes,
  meta: META_OAUTH_CONFIG.scopes,
} as const;

describe('parseAnalyticsScopesEnabled', () => {
  it('is none when unset or empty', () => {
    for (const raw of [undefined, '', '  ', ',']) {
      expect([...parseAnalyticsScopesEnabled(raw).enabled]).toEqual([]);
    }
  });

  it('reads a comma list, trimmed and case-folded', () => {
    expect(
      [...parseAnalyticsScopesEnabled(' YouTube, meta ').enabled].sort(),
    ).toEqual(['meta', 'youtube']);
  });

  it('reports what it did not recognise, and enables nothing for it', () => {
    const parsed = parseAnalyticsScopesEnabled('youtube,tiktoc,instagram');

    expect([...parsed.enabled]).toEqual(['youtube']);
    expect(parsed.unrecognised).toEqual(['tiktoc', 'instagram']);
  });
});

describe('connectScopes', () => {
  it('asks for exactly the pre-FILM-1711 scopes when a platform is off', () => {
    for (const platform of ['youtube', 'tiktok', 'meta'] as const) {
      expect(
        connectScopes(platform, CONFIG[platform], NO_ANALYTICS_SCOPES_ENABLED),
      ).toEqual(BEFORE_1711[platform]);
    }
  });

  it('asks for the whole config when a platform is on', () => {
    for (const platform of ['youtube', 'tiktok', 'meta'] as const) {
      expect(
        connectScopes(platform, CONFIG[platform], ALL_ANALYTICS_SCOPES_ENABLED),
      ).toEqual([...CONFIG[platform]]);
    }
  });

  it('turns platforms on one at a time', () => {
    const youtubeOnly = parseAnalyticsScopesEnabled('youtube').enabled;

    expect(connectScopes('youtube', CONFIG.youtube, youtubeOnly)).toContain(
      `${G}yt-analytics-monetary.readonly`,
    );
    expect(connectScopes('tiktok', CONFIG.tiktok, youtubeOnly)).toEqual(
      BEFORE_1711.tiktok,
    );
    expect(connectScopes('meta', CONFIG.meta, youtubeOnly)).toEqual(
      BEFORE_1711.meta,
    );
  });

  it('only ever withholds scopes the config requests', () => {
    for (const platform of ['youtube', 'tiktok', 'meta'] as const) {
      for (const scope of ANALYTICS_ADDED_SCOPES[platform]) {
        expect(CONFIG[platform]).toContain(scope);
      }
    }
    for (const scope of ANALYTICS_ADDED_SCOPES.facebook) {
      expect(CONFIG.meta).toContain(scope);
    }
  });

  it('keeps Facebook insights out of the Meta request until its own switch is on (FILM-1720)', () => {
    const metaOnly = parseAnalyticsScopesEnabled('meta').enabled;
    const both = parseAnalyticsScopesEnabled('meta,facebook').enabled;

    expect(connectScopes('meta', CONFIG.meta, metaOnly)).toContain(
      'instagram_manage_insights',
    );
    expect(connectScopes('meta', CONFIG.meta, metaOnly)).not.toContain(
      'read_insights',
    );
    expect(connectScopes('meta', CONFIG.meta, both)).toEqual(
      expect.arrayContaining(['read_insights', 'pages_manage_engagement']),
    );
    const facebookOnly = connectScopes(
      'meta',
      CONFIG.meta,
      parseAnalyticsScopesEnabled('facebook').enabled,
    );
    expect([...facebookOnly].sort()).toEqual(
      [...BEFORE_1711.meta, 'read_insights', 'pages_manage_engagement'].sort(),
    );
  });
});

describe('resolveAnalyticsAccess with a platform switched off', () => {
  it('reports a scope we do not ask for as not requested, with no reconnect', () => {
    const access = resolveAnalyticsAccess({
      platform: 'youtube',
      grantedScopes: BEFORE_1711.youtube,
      scopesEnabled: NO_ANALYTICS_SCOPES_ENABLED,
    });

    const revenue = access?.entries.find(
      (entry) => entry.requirementId === 'youtube.revenue',
    );

    expect(revenue?.state).toBe('not_requested');
    expect(access?.summary).toBe('not_authorised');
    // Reconnecting would ask for the same scopes and grant nothing new
    expect(access?.canReconnect).toBe(false);
  });

  it('is the ordinary missing-scope state once the platform is on', () => {
    const access = resolveAnalyticsAccess({
      platform: 'youtube',
      grantedScopes: BEFORE_1711.youtube,
      scopesEnabled: ALL_ANALYTICS_SCOPES_ENABLED,
    });

    expect(
      access?.entries.find((entry) => entry.requirementId === 'youtube.revenue')
        ?.state,
    ).toBe('scope_missing');
    expect(access?.canReconnect).toBe(true);
  });

  it('covers Instagram through the Meta switch, and TikTok through its own', () => {
    for (const [platform, grant, id] of [
      ['instagram', BEFORE_1711.meta, 'instagram.insights'],
      ['tiktok', BEFORE_1711.tiktok, 'tiktok.video-metrics'],
    ] as const) {
      const access = resolveAnalyticsAccess({
        platform,
        grantedScopes: grant,
        scopesEnabled: NO_ANALYTICS_SCOPES_ENABLED,
      });

      expect(
        access?.entries.find((entry) => entry.requirementId === id)?.state,
      ).toBe('not_requested');
      expect(access?.summary).toBe('not_authorised');
    }
  });

  it('still counts a scope the connection already holds', () => {
    const access = resolveAnalyticsAccess({
      platform: 'youtube',
      grantedScopes: [
        ...BEFORE_1711.youtube,
        `${G}yt-analytics-monetary.readonly`,
      ],
      scopesEnabled: NO_ANALYTICS_SCOPES_ENABLED,
    });

    expect(
      access?.entries.find((entry) => entry.requirementId === 'youtube.revenue')
        ?.state,
    ).toBe('authorised');
  });
});

describe('the sync does not depend on the switch', () => {
  // videoSyncAuthorisation answers from what a connection holds. The switch
  // only chooses among the ways of not holding a scope, so the answer is the
  // same with every platform on or off — which is why the sync, which runs
  // where this setting is not configured, does not read it.
  it('gives the same answer with every platform on and off', () => {
    const grants = [
      [],
      ...Object.values(BEFORE_1711),
      ...Object.values(REQUESTED_SCOPES),
      ...ANALYTICS_SCOPE_REQUIREMENTS.map((requirement) => requirement.scopes),
    ];

    for (const platform of ['youtube', 'tiktok', 'instagram', 'facebook']) {
      for (const grant of grants) {
        const states = [
          ALL_ANALYTICS_SCOPES_ENABLED,
          NO_ANALYTICS_SCOPES_ENABLED,
        ].map((scopesEnabled) =>
          resolveAnalyticsAccess({
            platform,
            grantedScopes: grant,
            scopesEnabled,
          })?.entries.map(({ requirementId, state }) => [
            requirementId,
            state === 'authorised' || state === 'unknown' ? state : 'no',
          ]),
        );

        expect(states[0]).toEqual(states[1]);
      }
    }
  });
});

describe('where the switch is read', () => {
  const REPO = resolve(__dirname, '../../../..');
  const read = (path: string) => readFileSync(resolve(REPO, path), 'utf8');

  it.each(['youtube', 'tiktok', 'meta'])(
    'the %s connect route builds its scope through the switch',
    (platform) => {
      const source = read(
        `apps/web/app/api/platforms/connect/${platform}/route.ts`,
      );

      expect(source).toContain('analyticsScopesEnabled()');
      expect(source).toMatch(/scope:\s*connectScopes\(/);
      expect(source).not.toMatch(/_OAUTH_CONFIG\.scopes\.join\(/);
    },
  );

  it('the web function receives the setting in its deployed environment', () => {
    const sst = read('sst.config.ts');
    const web = sst.slice(sst.indexOf("new sst.aws.Nextjs('StorybookWeb'"));

    expect(web.slice(0, web.indexOf('\n    });'))).toContain(
      'ANALYTICS_SCOPES_ENABLED: process.env.ANALYTICS_SCOPES_ENABLED',
    );
  });
});
