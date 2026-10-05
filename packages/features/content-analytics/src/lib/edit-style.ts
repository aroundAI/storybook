import { z } from 'zod';

/**
 * Edit style (FILM-2006): how a delivered episode was cut, derived from its
 * delivered session's summary. FILM-2003's deliver_edit stores that summary
 * with the explain-why report inside it, and the report's optional
 * `style {shotCount, hookType}` carries what the timeline knew (lead
 * decision, 2026-10-04 22:50). The Edit style card, the analytics-sync
 * rollup into ClickHouse's edit_sessions_fact and the genome's edit-style
 * dimensions all read this one function, so they cannot disagree.
 *
 * A figure the report does not carry is null — "not recorded" — never 0:
 * a report with no `style` has no cut count, and no operations at all has
 * no AI share.
 *
 * It lives here rather than beside `ExplainWhyReportSchema` in
 * @kit/desktop-integration because that package depends on this one
 * (FILM-2001's retention hints), so the report is read through the narrow
 * schema below: the fields this function uses, as that contract defines
 * them. deliver_edit validated the whole report on the way in.
 */
export interface EditStyle {
  /** Seconds of the delivered cut. */
  finalDuration: number;
  /** Seconds the edit aimed at: the report's target, else the episode's. */
  targetDuration: number | null;
  versions: number;
  aiOps: number;
  userOps: number;
  plansProposed: number | null;
  plansApproved: number | null;
  /** Cuts between consecutive shots: shotCount − 1. */
  cutCount: number | null;
  /** Seconds per shot: finalDuration / shotCount. */
  avgShotLength: number | null;
  /** Cuts per minute of the delivered cut. */
  cutsPerMinute: number | null;
  /** A genome `hook_type:` slug. */
  hookType: string | null;
  /** aiOps / (aiOps + userOps), 0..1. */
  aiShare: number | null;
}

/** The genome's slug rule (`content_tags`): lowercase, digits and hyphens. */
const HOOK_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The report's style block, read narrowly so a malformed one costs only the
 * figures it would have given.
 */
const ReportStyleSchema = z.object({
  shotCount: z.number().int().min(1),
  hookType: z.string().nullable().optional(),
});

const count = z.number().int().nonnegative();
const seconds = z.number().nonnegative();

const DeliveredReportSchema = z.object({
  versions: z.array(z.unknown()).min(1),
  finalDuration: seconds,
  aiOps: count,
  userOps: count,
  explain: z.object({ targetDuration: seconds.nullable().optional() }),
  style: z.unknown().optional(),
});

const DeliveredSummarySchema = z.object({
  versions: count.optional(),
  plansProposed: count.optional(),
  plansApproved: count.optional(),
  report: z.unknown(),
});

const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * Null when the summary holds no valid report, which is every session that
 * was not delivered.
 */
export function deriveEditStyle(input: {
  summary: unknown;
  episodeTargetDurationSeconds?: number | null;
}): EditStyle | null {
  const summary = DeliveredSummarySchema.safeParse(input.summary);

  if (!summary.success) return null;

  const report = DeliveredReportSchema.safeParse(summary.data.report);

  if (!report.success) return null;

  const { finalDuration, aiOps, userOps, versions, explain } = report.data;
  const style = ReportStyleSchema.safeParse(report.data.style);
  const shotCount = style.success ? style.data.shotCount : null;
  const hook = style.success ? (style.data.hookType ?? null) : null;

  const cutCount = shotCount === null ? null : shotCount - 1;
  const minutes = finalDuration / 60;
  const operations = aiOps + userOps;

  return {
    finalDuration,
    targetDuration:
      explain.targetDuration ?? input.episodeTargetDurationSeconds ?? null,
    versions: summary.data.versions ?? versions.length,
    aiOps,
    userOps,
    plansProposed: summary.data.plansProposed ?? null,
    plansApproved: summary.data.plansApproved ?? null,
    cutCount,
    avgShotLength:
      shotCount === null || finalDuration <= 0
        ? null
        : round(finalDuration / shotCount),
    cutsPerMinute:
      cutCount === null || minutes <= 0 ? null : round(cutCount / minutes),
    hookType: hook !== null && HOOK_SLUG.test(hook) ? hook : null,
    aiShare: operations > 0 ? round(aiOps / operations) : null,
  };
}
