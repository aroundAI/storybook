/**
 * Why one creator's Monetisation stage has no figure (FILM-1726).
 *
 * Monetisation is the first stage that needs every kind of absence at
 * once. Each kind has a different owner, so each gets its own sentence:
 *
 * - `unsupported`: the platform's. TikTok and Instagram report no earnings
 *   on any API. Nothing anyone ships changes that.
 * - `account_type_gated`: the creator's. YouTube reports earnings only for
 *   Partner Program channels. Facebook reports them only to the admin of a
 *   Page that earns from ad breaks.
 * - `scope_missing`, `not_requested` and the review states: ours. The
 *   connection lacks the scope, our request leaves the scope out, or the
 *   vendor has not approved our app.
 *
 * The static half comes from `CAPABILITY_MATRIX.revenue`. The per-connection
 * half is what `resolveAnalyticsAccess` (publishing) answers from the scopes
 * recorded at the connection's callback. This package cannot import it, so
 * the caller passes its state for the revenue requirement in.
 *
 * Pure and client-safe, like the rest of `lib/`.
 */
import type { AnalyticsPlatform } from '../types';
import { CAPABILITY_MATRIX } from './data-provenance';
import type { OurAccessState } from './data-provenance';

/**
 * Publishing's `AnalyticsAccessState` without `no_provider`. A test reads
 * that union from its source, so the two cannot drift apart.
 */
export const CONNECTION_REVENUE_STATES = [
  'authorised',
  'unknown',
  'scope_missing',
  'review_pending',
  'not_requested',
  'account_type_gated',
] as const;

export type ConnectionRevenueState = (typeof CONNECTION_REVENUE_STATES)[number];

export interface RevenueConnection {
  /**
   * The connection's state for the platform's revenue requirement, or null
   * when no requirement covers revenue on this platform yet.
   */
  revenue: ConnectionRevenueState | null;
}

export type MonetisationAccessState =
  | 'unsupported'
  | 'account_type_gated'
  | 'not_requested'
  | OurAccessState;

export interface MonetisationAccess {
  state: MonetisationAccessState;
  /** Who can change it. Null when nothing stands in the way. */
  owner: 'platform' | 'creator' | 'us' | null;
  /** True only when reconnecting now would grant the missing scope. */
  reconnect: boolean;
  /** One sentence, rendered verbatim to the creator. */
  note: string;
}

const OUR_SENTENCE: Record<
  Exclude<OurAccessState, 'authorised'> | 'not_requested',
  string
> = {
  scope_missing:
    'This account was connected before we asked for permission to read its earnings. Reconnect it to grant that permission.',
  not_requested:
    'We do not ask for permission to read earnings yet, so reconnecting would not change anything.',
  review_required:
    'The platform has to approve our app before we can read earnings, so there is nothing for you to do yet.',
  review_pending:
    'We have asked the platform to approve our app for reading earnings, and are waiting for its answer.',
  review_denied:
    'The platform turned down our request to read earnings, so they cannot be shown.',
};

export function monetisationAccess(
  platform: AnalyticsPlatform,
  connection: RevenueConnection,
): MonetisationAccess {
  const capability = CAPABILITY_MATRIX.revenue[platform];

  if (capability.level === 'unsupported') {
    return {
      state: 'unsupported',
      owner: 'platform',
      reconnect: false,
      note: capability.note,
    };
  }

  if (connection.revenue === 'account_type_gated' && capability.accountGate) {
    return {
      state: 'account_type_gated',
      owner: 'creator',
      reconnect: false,
      note: capability.accountGate.note,
    };
  }

  // A missing scope that the vendor will not grant until it reviews our app
  // is the review's problem: reconnecting would ask for nothing new.
  const reviewStandsFirst =
    connection.revenue === 'scope_missing' &&
    capability.access !== 'authorised';

  if (
    !reviewStandsFirst &&
    (connection.revenue === 'scope_missing' ||
      connection.revenue === 'not_requested' ||
      connection.revenue === 'review_pending')
  ) {
    return {
      state: connection.revenue,
      owner: 'us',
      reconnect: connection.revenue === 'scope_missing',
      note: OUR_SENTENCE[connection.revenue],
    };
  }

  // Authorised, unknown, or no requirement yet: our configuration answers.
  if (capability.access === 'authorised') {
    return {
      state: 'authorised',
      owner: null,
      reconnect: false,
      note: capability.note,
    };
  }

  return {
    state: capability.access,
    owner: 'us',
    reconnect: false,
    note: OUR_SENTENCE[capability.access],
  };
}
