import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { queryRetentionCurve } from '@kit/clickhouse/server';

import {
  retentionAtSeconds,
  retentionFull as retentionFullOf,
} from '../lib/retention';

// Use generic SupabaseClient type to avoid strict type checking issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Client = SupabaseClient<any, any, any>;

export interface VariantRetention {
  retention1s: number | null;
  retention3s: number | null;
  retention5s: number | null;
  retentionFull: number | null;
}

/**
 * Computes a hook variant's retention checkpoints from the generic
 * ClickHouse retention curve (FILM-1505).
 *
 * Platforms report retention as normalized positions through the video,
 * so absolute checkpoints require the video's duration — taken from the
 * variant when set, otherwise from video_dim via the linked publish.
 * Returns null when neither the curve nor a duration is available, rather
 * than inventing comparable-looking numbers.
 */
export async function computeVariantRetention(
  publishId: string,
  durationSeconds: number,
): Promise<VariantRetention | null> {
  if (durationSeconds <= 0) return null;

  const points = await queryRetentionCurve({ videoId: publishId });

  if (points.length === 0) return null;

  return {
    retention1s: retentionAtSeconds(points, 1, durationSeconds),
    retention3s: retentionAtSeconds(points, 3, durationSeconds),
    retention5s: retentionAtSeconds(points, 5, durationSeconds),
    retentionFull: retentionFullOf(points),
  };
}

/**
 * Refreshes cached retention for every variant in a test and declares a
 * winner when one clears the test's viral threshold at 3 seconds.
 *
 * The threshold is a floor, not a race: if no variant clears it, no
 * winner is declared, because "best of a bad set" is not a finding.
 */
export async function refreshTestRetention(
  client: Client,
  testId: string,
): Promise<{ updated: number; winnerVariantId: string | null }> {
  const { data: test } = await client
    .from('hook_tests')
    .select('viral_threshold')
    .eq('id', testId)
    .single();

  const threshold = Number(test?.viral_threshold ?? 0.75);

  const { data: variants } = await client
    .from('hook_variants')
    .select('id, publish_id, duration_seconds')
    .eq('test_id', testId);

  let updated = 0;
  let best: { id: string; retention3s: number } | null = null;

  for (const variant of variants ?? []) {
    if (!variant.publish_id) continue;

    const duration = Number(variant.duration_seconds ?? 0);
    const retention = await computeVariantRetention(
      variant.publish_id,
      duration,
    );

    if (!retention) continue;

    await client
      .from('hook_variants')
      .update({
        retention_1s: retention.retention1s,
        retention_3s: retention.retention3s,
        retention_5s: retention.retention5s,
        retention_full: retention.retentionFull,
        retention_updated_at: new Date().toISOString(),
      })
      .eq('id', variant.id);

    updated++;

    if (
      retention.retention3s !== null &&
      retention.retention3s >= threshold &&
      (!best || retention.retention3s > best.retention3s)
    ) {
      best = { id: variant.id, retention3s: retention.retention3s };
    }
  }

  // The unique partial index allows one winner per test, so clear first
  await client
    .from('hook_variants')
    .update({ is_winner: false })
    .eq('test_id', testId);

  if (best) {
    await client
      .from('hook_variants')
      .update({ is_winner: true })
      .eq('id', best.id);
  }

  return { updated, winnerVariantId: best?.id ?? null };
}
