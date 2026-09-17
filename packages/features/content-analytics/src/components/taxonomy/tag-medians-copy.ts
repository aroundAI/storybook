/** What a median row is: a taxonomy tag, or a `video_dim` column. */
export type SegmentNoun = 'tag' | 'language';

/**
 * The sample-gate wording for a segment kind.
 *
 * Its own module, and free of JSX, so the wording is unit-testable: this
 * package's tests run in `node` and cannot render a component. The gate said
 * "videos are tagged" whatever the segment — telling an operator to tag
 * videos so that *language* medians unlock, which is not a thing anyone can
 * do. A language comes from the video row, not from the taxonomy.
 */
export function sampleGateCopy(
  segmentNoun: SegmentNoun,
  required: number,
  taggedCount: number,
): { headline: string; progressLabel: string } {
  if (segmentNoun === 'language') {
    return {
      headline: `Language medians unlock once ${required} videos have a language recorded — below that, per-language samples are too small to separate a real effect from luck.`,
      progressLabel: `${taggedCount} of ${required} videos with a language`,
    };
  }

  return {
    headline: `Tag-level medians unlock once ${required} videos are tagged — below that, per-tag samples are too small to separate a real format effect from luck.`,
    progressLabel: `${taggedCount} of ${required} videos tagged`,
  };
}
