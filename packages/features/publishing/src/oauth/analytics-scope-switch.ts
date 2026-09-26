/**
 * Which platforms' connect requests carry the analytics scopes FILM-1711
 * added (#289).
 *
 * #289 put the new scopes in every connect request at once. A vendor may
 * reject an authorise request that names a scope it has not approved for the
 * app, and the same request carries the publishing scopes — so on that
 * platform connecting, and with it publishing, would break. This switch lets
 * the owner turn each platform on after its pre-deploy consent-screen check
 * (FILM-1725 Check F) passes, instead of holding the whole deploy.
 *
 * Read from `ANALYTICS_SCOPES_ENABLED` (`server/analytics-scope-switch.ts`).
 * Unset is **none**: the request production made before FILM-1711.
 *
 * Pure and client-safe; only the reader of the environment is server-only.
 */

/** The OAuth apps whose requests the switch controls. Meta covers Instagram and Facebook: one Facebook Login dialog. */
export type ScopeSwitchPlatform = 'youtube' | 'tiktok' | 'meta';

export const SCOPE_SWITCH_PLATFORMS: readonly ScopeSwitchPlatform[] = [
  'youtube',
  'tiktok',
  'meta',
];

/**
 * The scopes #289 added to each connect request, and nothing else. Without
 * them a request is exactly the pre-FILM-1711 one (asserted against
 * `d8c635c1` in `analytics-scope-switch.test.ts`).
 */
export const ANALYTICS_ADDED_SCOPES: Record<
  ScopeSwitchPlatform,
  readonly string[]
> = {
  youtube: ['https://www.googleapis.com/auth/yt-analytics-monetary.readonly'],
  tiktok: ['video.list', 'user.info.stats'],
  meta: ['instagram_manage_insights'],
};

export type AnalyticsScopeSwitch = ReadonlySet<ScopeSwitchPlatform>;

export const NO_ANALYTICS_SCOPES_ENABLED: AnalyticsScopeSwitch = new Set();

export const ALL_ANALYTICS_SCOPES_ENABLED: AnalyticsScopeSwitch = new Set(
  SCOPE_SWITCH_PLATFORMS,
);

function isScopeSwitchPlatform(value: string): value is ScopeSwitchPlatform {
  return (SCOPE_SWITCH_PLATFORMS as readonly string[]).includes(value);
}

/**
 * `ANALYTICS_SCOPES_ENABLED`, e.g. `youtube,meta`. Anything unrecognised
 * enables nothing and is returned so the reader can log it: a typo keeps a
 * platform on the safe, pre-FILM-1711 request rather than failing a deploy.
 */
export function parseAnalyticsScopesEnabled(raw: string | undefined): {
  enabled: AnalyticsScopeSwitch;
  unrecognised: string[];
} {
  const tokens = (raw ?? '')
    .split(',')
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);

  return {
    enabled: new Set(tokens.filter(isScopeSwitchPlatform)),
    unrecognised: tokens.filter((token) => !isScopeSwitchPlatform(token)),
  };
}

/** The scopes a connect request names: the config, less the platform's added scopes while it is off. */
export function connectScopes(
  platform: ScopeSwitchPlatform,
  configScopes: readonly string[],
  enabled: AnalyticsScopeSwitch,
): string[] {
  if (enabled.has(platform)) return [...configScopes];

  const withheld = new Set(ANALYTICS_ADDED_SCOPES[platform]);

  return configScopes.filter((scope) => !withheld.has(scope));
}

/** The switch that governs an analytics platform's connect request. */
export function scopeSwitchFor(
  analyticsPlatform: string,
): ScopeSwitchPlatform | null {
  switch (analyticsPlatform) {
    case 'youtube':
      return 'youtube';
    case 'tiktok':
      return 'tiktok';
    case 'instagram':
    case 'facebook':
      return 'meta';
    default:
      return null;
  }
}

/** Whether a connect request for this platform leaves `scope` out. */
export function isScopeWithheld(
  analyticsPlatform: string,
  scope: string,
  enabled: AnalyticsScopeSwitch,
): boolean {
  const platform = scopeSwitchFor(analyticsPlatform);

  return (
    platform !== null &&
    !enabled.has(platform) &&
    ANALYTICS_ADDED_SCOPES[platform].includes(scope)
  );
}
