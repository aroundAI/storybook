import type http from 'node:http';

import { sendJson } from '../../../http';
import type { SocialState } from '../../state';
import { graphError } from './errors';

/**
 * Meta's business-use-case rate limit, as Instagram calls see it
 * (https://developers.facebook.com/docs/graph-api/overview/rate-limiting/):
 * every response carries `X-Business-Use-Case-Usage` — the share of an
 * hourly allowance used, as whole-number percentages, under
 * `"type": "instagram"` — and a call past 100% is refused with code 80002.
 *
 * The allowance here is small enough that a backfill meets it, so the app's
 * pacing (#469) has something real to pace against.
 */
export const HOURLY_INSTAGRAM_CALLS = 200;

const HOUR_MS = 3_600_000;
const NAMESPACE = 'meta-ig-calls';

interface MeteredCall {
  accountId: string;
  atMs: number;
}

/** The share of the hour's allowance this account has used, as Meta states it. */
export function usagePercent(social: SocialState, accountId: string) {
  const since = social.now() - HOUR_MS;
  const calls = social
    .list<MeteredCall>(NAMESPACE)
    .filter((c) => c.accountId === accountId && c.atMs > since).length;
  return Math.min(100, Math.floor((calls * 100) / HOURLY_INSTAGRAM_CALLS));
}

/**
 * Counts one Instagram call and sets the usage header. Answers the call
 * itself — code 80002 — when the allowance is spent, and returns false.
 */
export function meterInstagramCall(
  social: SocialState,
  res: http.ServerResponse,
  accountId: string,
  businessId: string,
): boolean {
  const spent = usagePercent(social, accountId) >= 100;
  if (!spent)
    social.add<MeteredCall>(NAMESPACE, { accountId, atMs: social.now() });

  const percent = usagePercent(social, accountId);
  res.setHeader(
    'x-business-use-case-usage',
    JSON.stringify({
      [businessId]: [
        {
          type: 'instagram',
          call_count: percent,
          total_cputime: Math.floor(percent / 2),
          total_time: Math.floor(percent / 2),
          estimated_time_to_regain_access: spent ? 60 : 0,
        },
      ],
    }),
  );

  if (spent) {
    sendJson(
      res,
      400,
      graphError(
        80002,
        'There have been too many calls to this Instagram account. Wait a bit and try again.',
        'OAuthException',
      ),
    );
    return false;
  }
  return true;
}
