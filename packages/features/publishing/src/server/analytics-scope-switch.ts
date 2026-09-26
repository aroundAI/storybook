import 'server-only';

import {
  type AnalyticsScopeSwitch,
  parseAnalyticsScopesEnabled,
} from '../oauth/analytics-scope-switch';

let warned = false;

/**
 * `ANALYTICS_SCOPES_ENABLED`: the platforms (`youtube`, `tiktok`, `meta`)
 * whose connect requests carry FILM-1711's analytics scopes. Unset is none.
 * Turn a platform on only after its FILM-1725 Check F passes
 * (docs/vendor-review-runbook.md, Part 1).
 */
export function analyticsScopesEnabled(): AnalyticsScopeSwitch {
  const { enabled, unrecognised } = parseAnalyticsScopesEnabled(
    process.env.ANALYTICS_SCOPES_ENABLED,
  );

  if (unrecognised.length > 0 && !warned) {
    warned = true;
    console.warn(
      `[analytics] ANALYTICS_SCOPES_ENABLED: ignoring ${unrecognised.join(', ')} (expected youtube, tiktok or meta)`,
    );
  }

  return enabled;
}
