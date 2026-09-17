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
  /**
   * True only where the `unknown`-status over-state rule actually raised a
   * target above plain channel-then-account precedence.
   *
   * The card used to infer this from `applicantStatus === 'unknown'`, which
   * is the default for every channel — so a brand-new account was told the
   * higher configured target was being shown when nothing was configured at
   * all. A sentence that claims a rule fired owes a value that says it did.
   */
  escalated: boolean;
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
    escalated: watchHours.escalated || subscribers.escalated,
    joinedYppAt,
    alreadyJoined: joinedYppAt !== null,
  };
}

interface ResolvedOne {
  value: number;
  basis: TargetBasis;
  /** True only when the over-state rule actually changed the answer. */
  escalated: boolean;
}

function resolveOne(
  channel: number | null,
  account: number | null,
  fallback: number,
  status: YppApplicantStatus,
): ResolvedOne {
  const candidates: Array<{ value: number; basis: TargetBasis }> = [];

  // Non-positive values are treated as unconfigured rather than trusted.
  // A database constraint rejects them now, but every one of these numbers
  // is a denominator — `Math.min(1, hours / 0)` is 1, which reports the gate
  // as *met* — and this is the single place they become one. A row that
  // predates the constraint, or arrives through some path that does not go
  // near it, degrades to the shipped default instead of to a false pass.
  if (channel !== null && channel > 0) {
    candidates.push({ value: channel, basis: 'channel' });
  }

  if (account !== null && account > 0) {
    candidates.push({ value: account, basis: 'account' });
  }

  if (candidates.length === 0) {
    return { value: fallback, basis: 'default', escalated: false };
  }

  // Both levels configured and disagreeing is the only shape the status can
  // act on. `candidates[0]` is the channel whenever there is one, so plain
  // precedence is the default answer.
  const disagree =
    candidates.length > 1 && candidates[0]!.value !== candidates[1]!.value;

  if (status === 'unknown' && disagree) {
    const highest = candidates.reduce((best, candidate) =>
      candidate.value > best.value ? candidate : best,
    );

    // Escalation only counts when it moved the answer off plain precedence.
    // Reporting it otherwise makes the card claim a bar was raised when the
    // channel's own value was already the higher one.
    return { ...highest, escalated: highest.basis !== candidates[0]!.basis };
  }

  return { ...candidates[0]!, escalated: false };
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

/**
 * The account-wide minimum sample size for tag medians.
 *
 * Non-positive is treated as unset, matching `resolveOne`: a threshold of
 * zero would admit every tag with no videos behind it into a median, which
 * is the opposite of what the setting is for.
 */
export function resolveTagMinSample(
  accountSettings: { tag_min_sample: number | null } | null,
): number {
  const configured = accountSettings?.tag_min_sample ?? null;

  return configured !== null && configured > 0
    ? configured
    : ANALYTICS_DEFAULTS.tagMinSample;
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

export interface OverriddenTarget {
  metric: 'watchHours' | 'subscribers';
  /** What the operator typed on the channel. */
  channel: number;
  /** What `resolveYppTarget` will actually measure against. */
  resolved: number;
}

/**
 * Channel overrides that will not be the target actually used.
 *
 * The settings form warns before saving one of these, and it needs to be a
 * *consequence* of the resolution rule rather than a second copy of it. The
 * first version of that warning re-derived the rule — "is the channel value
 * lower than the account's?" — and got it wrong in the most common case
 * there is: with no account row at all it compared against the shipped
 * default and announced that a perfectly good override would be ignored.
 * `resolveOne` escalates only when *both* levels hold a value, so it would
 * not have been.
 *
 * Asking the resolver also means this covers every reason an override loses,
 * not only the `unknown`-status escalation that prompted it, and a
 * non-positive value needs no special case — `resolveOne` already treats one
 * as unconfigured, so it resolves to some other basis and reports nothing.
 */
export function overriddenChannelTargets({
  channelSettings,
  accountSettings,
}: ResolveInput): OverriddenTarget[] {
  const resolved = resolveYppTarget({ channelSettings, accountSettings });

  // A channel already in the programme is past the gate, and nothing measures
  // it against a target — `YppProgressCard` returns early on `alreadyJoined`.
  // Warning that its override will be overruled would describe a comparison
  // that never happens.
  if (resolved.alreadyJoined) return [];

  const candidates: Array<{
    metric: OverriddenTarget['metric'];
    channel: number | null;
    basis: TargetBasis;
    resolved: number;
  }> = [
    {
      metric: 'watchHours',
      channel: channelSettings?.ypp_target_watch_hours ?? null,
      basis: resolved.watchHoursBasis,
      resolved: resolved.watchHours,
    },
    {
      metric: 'subscribers',
      channel: channelSettings?.ypp_target_subscribers ?? null,
      basis: resolved.subscribersBasis,
      resolved: resolved.subscribers,
    },
  ];

  return candidates
    .filter(
      (candidate) =>
        candidate.channel !== null &&
        candidate.channel > 0 &&
        candidate.basis !== 'channel',
    )
    .map(({ metric, channel, resolved: value }) => ({
      metric,
      channel: channel!,
      resolved: value,
    }));
}
