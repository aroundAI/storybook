/**
 * Resolving the YPP gate targets for a channel (FILM-1608).
 *
 * Pure on purpose: no Supabase client, no I/O, rows passed in by the caller.
 * ClickHouse is unprovisioned and every deep-dive number reads zero without
 * it, so this is the only part of the feature that can be verified at all
 * today — which is worth more than the convenience of fetching in here.
 *
 * It exists because the same rule used to live in two `??` expressions in two
 * files, and they had already diverged: `tag_min_sample` resolved differently
 * from the YPP targets despite reading the same table.
 */

/** The numbers that ship when nothing is configured. */
export const ANALYTICS_DEFAULTS = {
  watchHours: 4000,
  subscribers: 1000,
  tagMinSample: 5,
} as const;

/**
 * The three values `channel_analytics_settings.ypp_applicant_status` admits.
 *
 * One list, exported, because the same set otherwise has to be restated in
 * the Zod schema and the check constraint — and a list restated is a list
 * that drifts. The schema builds its enum from this array; a pgTAP case
 * holds the check constraint to it.
 */
export const YPP_APPLICANT_STATUSES = [
  'unknown',
  'new_applicant',
  'existing_partner',
] as const;

export type YppApplicantStatus = (typeof YPP_APPLICANT_STATUSES)[number];

/** Where a resolved number came from. Reported per metric — see below. */
export type TargetBasis = 'channel' | 'account' | 'default';

export interface AccountSettingsRow {
  ypp_target_watch_hours: number | null;
  ypp_target_subscribers: number | null;
}

export interface ChannelSettingsRow {
  ypp_target_watch_hours: number | null;
  ypp_target_subscribers: number | null;
  ypp_applicant_status: string;
  joined_ypp_at: string | null;
}

export interface ResolvedYppTarget {
  watchHours: number;
  subscribers: number;
  /**
   * A basis per metric, not one for the pair.
   *
   * The two override columns are independently nullable, so a channel that
   * sets a subscriber target and inherits its watch-hours target is an
   * ordinary row, not an edge case. A single `basis` field would have to
   * pick one of them and be wrong about the other.
   */
  watchHoursBasis: TargetBasis;
  subscribersBasis: TargetBasis;
  applicantStatus: YppApplicantStatus;
  joinedYppAt: string | null;
  alreadyJoined: boolean;
}

interface ResolveInput {
  channelSettings: ChannelSettingsRow | null;
  accountSettings: AccountSettingsRow | null;
}

/**
 * Channel -> account -> default, with one exception.
 *
 * The exception is the phase's locked decision on applicant status: where an
 * account and a channel have *both* been configured and disagree, an
 * applicant status of `unknown` resolves to the higher of the two rather than
 * the nearer one. Over-stating the bar shows a channel short of a gate it may
 * have cleared; under-stating it announces a gate it has not. Only the second
 * is a number someone might act on.
 *
 * An unconfigured level is not a disagreement, so a status of `unknown`
 * against a single configured target is inert — the target is simply the
 * configured one. No escalation *date* appears here: the escalated threshold
 * is a value an operator sets once they have confirmed the policy, because a
 * hardcoded date that fires early or late halves every channel's progress
 * silently, with nothing on screen to explain why the goal moved.
 */
export function resolveYppTarget({
  channelSettings,
  accountSettings,
}: ResolveInput): ResolvedYppTarget {
  const applicantStatus = toApplicantStatus(
    channelSettings?.ypp_applicant_status,
  );

  const watchHours = resolveOne(
    channelSettings?.ypp_target_watch_hours ?? null,
    accountSettings?.ypp_target_watch_hours ?? null,
    ANALYTICS_DEFAULTS.watchHours,
    applicantStatus,
  );

  const subscribers = resolveOne(
    channelSettings?.ypp_target_subscribers ?? null,
    accountSettings?.ypp_target_subscribers ?? null,
    ANALYTICS_DEFAULTS.subscribers,
    applicantStatus,
  );

  const joinedYppAt = channelSettings?.joined_ypp_at ?? null;

  return {
    watchHours: watchHours.value,
    watchHoursBasis: watchHours.basis,
    subscribers: subscribers.value,
    subscribersBasis: subscribers.basis,
    applicantStatus,
    joinedYppAt,
    alreadyJoined: joinedYppAt !== null,
  };
}

function resolveOne(
  channel: number | null,
  account: number | null,
  fallback: number,
  status: YppApplicantStatus,
): { value: number; basis: TargetBasis } {
  const candidates: Array<{ value: number; basis: TargetBasis }> = [];

  if (channel !== null) candidates.push({ value: channel, basis: 'channel' });
  if (account !== null) candidates.push({ value: account, basis: 'account' });

  if (candidates.length === 0) {
    return { value: fallback, basis: 'default' };
  }

  // Both levels configured and disagreeing is the only shape the status can
  // act on. `candidates[0]` is the channel whenever there is one, so plain
  // precedence is the default answer.
  const escalated =
    candidates.length > 1 && candidates[0]!.value !== candidates[1]!.value;

  if (status === 'unknown' && escalated) {
    return candidates.reduce((highest, candidate) =>
      candidate.value > highest.value ? candidate : highest,
    );
  }

  return candidates[0]!;
}

function toApplicantStatus(raw: string | undefined): YppApplicantStatus {
  // A check constraint keeps the column to these three, but the generated
  // type is a bare string. Narrowing here rather than casting means a value
  // that somehow escapes the constraint lands on the conservative branch
  // instead of flowing through as an unhandled status.
  return raw === 'new_applicant' || raw === 'existing_partner'
    ? raw
    : 'unknown';
}

/** The account-wide minimum sample size for tag medians. */
export function resolveTagMinSample(
  accountSettings: { tag_min_sample: number | null } | null,
): number {
  return accountSettings?.tag_min_sample ?? ANALYTICS_DEFAULTS.tagMinSample;
}

const WHOLE_NUMBER = /^\d+$/;

/**
 * What the user typed in an override field, as something writable.
 *
 * Three outcomes, because the field genuinely has three states:
 *
 * - `null`  — the field is empty, meaning *inherit*. This is the one the
 *   repo's existing numeric idiom cannot express: `parseInt(value, 10) || 5`
 *   turns a cleared field into the default, so an override becomes
 *   impossible to remove once set.
 * - a number — a positive whole number to store.
 * - `undefined` — not a number; write nothing and let the resolver complain.
 *
 * Rejects rather than partially parses. `Number.parseInt` reads a numeric
 * *prefix*, so a pasted `1,250` would store 1 — the same shape that
 * overwrote real revenue figures with $1.00 in FILM-1609.
 */
export function parseOptionalInteger(raw: string): number | null | undefined {
  const text = raw.trim();

  if (text === '') return null;
  if (!WHOLE_NUMBER.test(text)) return undefined;

  const value = Number.parseInt(text, 10);

  // Zero is rejected rather than stored: every use of these numbers is a
  // denominator, and a target of nothing renders as 100% complete.
  return value > 0 ? value : undefined;
}
