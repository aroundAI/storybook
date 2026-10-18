/**
 * `video_traffic_sources` as one copy per (video, day) (migration 025,
 * FILM-1734).
 *
 * The Reporting CSV and the Analytics API both write a video's traffic
 * sources for a day, each under its own `metric_source`, because they name
 * the sources in different vocabularies and could not replace each other on
 * a shared key. Read both and a day is counted twice. Every reader goes
 * through this instead: the CSV's copy where it has the day — it is the
 * reconciled report, and every reader before migration 025 read only it —
 * else the Analytics API's, which arrives a day or two sooner.
 *
 * Anything not `analytics_api` is the CSV's: migration 025 renamed the
 * rows written before it, and nothing else writes the table. `where` is a
 * fixed SQL condition built by the caller from bound parameters, never from
 * input.
 */
export function trafficSourcesOneCopy(where: string): string {
  return `(
    SELECT * EXCEPT (day_has_csv)
    FROM (
      SELECT
        *,
        max(metric_source != 'analytics_api')
          OVER (PARTITION BY video_id, metric_date) AS day_has_csv
      FROM video_traffic_sources FINAL
      WHERE ${where}
    )
    WHERE metric_source != 'analytics_api' OR day_has_csv = 0
  )`;
}
