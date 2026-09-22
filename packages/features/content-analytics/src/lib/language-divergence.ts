/**
 * How often a video's language and its channel's target language disagree
 * (FILM-1702).
 *
 * Pure, so the rule that matters here can be tested without a server: an
 * absent language is not a disagreement. Comparing the two as strings would
 * count every unlabelled video as misrouted — `null !== 'en'` — and the
 * diagnostic would mostly measure how much was never labelled.
 */
export interface LanguagePair {
  /** The published asset's language; null when nobody set one. */
  language: string | null;
  /** The channel's target language; null for a publish with no channel. */
  channelLanguage: string | null;
  videoCount: number;
}

export interface LanguageDivergence {
  totalVideos: number;
  /** Videos with both languages set — the only ones that can disagree. */
  comparableVideos: number;
  /** Comparable videos whose language differs from their channel's target. */
  divergentVideos: number;
  /** Videos nobody set a language on. Not divergent: unknown. */
  contentNotSetVideos: number;
  /** Videos published outside a connected channel. Not divergent either. */
  channelNotSetVideos: number;
  /** The disagreeing pairs, most videos first. */
  divergentPairs: Array<{
    language: string;
    channelLanguage: string;
    videoCount: number;
  }>;
}

export function summariseLanguagePairs(
  pairs: LanguagePair[],
): LanguageDivergence {
  const summary: LanguageDivergence = {
    totalVideos: 0,
    comparableVideos: 0,
    divergentVideos: 0,
    contentNotSetVideos: 0,
    channelNotSetVideos: 0,
    divergentPairs: [],
  };

  for (const pair of pairs) {
    summary.totalVideos += pair.videoCount;

    if (pair.language === null) summary.contentNotSetVideos += pair.videoCount;

    if (pair.channelLanguage === null) {
      summary.channelNotSetVideos += pair.videoCount;
    }

    if (pair.language === null || pair.channelLanguage === null) continue;

    summary.comparableVideos += pair.videoCount;

    if (pair.language === pair.channelLanguage) continue;

    summary.divergentVideos += pair.videoCount;
    summary.divergentPairs.push({
      language: pair.language,
      channelLanguage: pair.channelLanguage,
      videoCount: pair.videoCount,
    });
  }

  summary.divergentPairs.sort(
    (a, b) =>
      b.videoCount - a.videoCount ||
      a.language.localeCompare(b.language) ||
      a.channelLanguage.localeCompare(b.channelLanguage),
  );

  return summary;
}
