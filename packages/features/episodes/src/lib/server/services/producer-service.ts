/**
 * Producer Service
 * Phase 11: FILM-1134
 *
 * Plans news episode rundowns (segment ordering, duration allocation, pacing)
 * and orchestrates segment generation via the anchor service (FILM-1133).
 */
import { escapeXml } from '../../utils/escape-xml';
import type { AnchorScript } from './anchor-service';
import { NewsStoryService } from './news-story-service';
import type { StoryCluster } from './news-story-service';

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single segment in an episode rundown */
export interface RundownSegment {
  segmentNumber: number;
  title: string;
  /** Duration in seconds */
  duration: number;
  category: string;
  /** Search query for fetching articles for this segment */
  searchQuery: string;
  priority: 'high' | 'medium' | 'low';
}

/** Complete episode rundown from the LLM */
export interface EpisodeRundown {
  rundown: RundownSegment[];
  /** Total planned runtime in seconds */
  totalRuntime: number;
  /**
   * `segmentNumber`s a commercial break follows. Breaks fall between
   * segments, never after the last, and their count follows the runtime
   * (`breakCountFor`).
   */
  breakPositions: number[];
}

/** A segment with its generated anchor script attached */
export interface OrchestratedSegment extends RundownSegment {
  script: AnchorScript;
}

/** Full orchestrated episode output */
export interface OrchestratedEpisode {
  rundown: EpisodeRundown;
  segments: OrchestratedSegment[];
}

export interface PlanRundownOptions {
  /** Episode title for context */
  episodeTitle: string;
  /** Target duration in minutes */
  totalDuration: number;
  /** Optional topic filters for story discovery */
  topics?: string[];
  /** Required for executeLLM context logging */
  accountId: string;
}

/**
 * Options for full episode orchestration.
 * Extends PlanRundownOptions — extra fields (e.g. voiceTone, style) can be
 * added here in the future without changing the planning interface.
 */
export type OrchestrateEpisodeOptions = PlanRundownOptions;

// ─── Constants ───────────────────────────────────────────────────────────────

/** Max story clusters to include in the producer prompt */
const MAX_STORIES_FOR_RUNDOWN = 15;

/** Fallback segment duration (seconds) when LLM generation fails */
const FALLBACK_SEGMENT_DURATION_SECONDS = 60;

/** Importance score threshold for "high" priority classification */
const HIGH_IMPORTANCE_THRESHOLD = 0.7;

/** Importance score threshold for "medium" priority classification */
const MEDIUM_IMPORTANCE_THRESHOLD = 0.4;

/** One break for every full five minutes of runtime */
const BREAK_INTERVAL_SECONDS = 300;

/** Max allowed length for an LLM-generated search query */
const MAX_SEARCH_QUERY_LENGTH = 200;

// ─── Singleton ───────────────────────────────────────────────────────────────

let _newsStoryService: NewsStoryService | null = null;

function getNewsStoryService(): NewsStoryService {
  _newsStoryService ??= new NewsStoryService();

  return _newsStoryService;
}

// ─── Service Functions ───────────────────────────────────────────────────────

/**
 * Plan an episode rundown from discovered stories.
 *
 * Flow: discover stories → format for prompt → LLM plans rundown
 */
export async function planEpisodeRundown(
  options: PlanRundownOptions,
): Promise<EpisodeRundown> {
  const { episodeTitle, totalDuration, topics, accountId } = options;

  // 1. Discover stories using NewsStoryService (singleton)
  const stories = await getNewsStoryService().discoverTopStories({
    date: new Date(),
    topics,
    maxStories: MAX_STORIES_FOR_RUNDOWN,
    accountId,
  });

  if (stories.length === 0) {
    return buildFallbackRundown(totalDuration);
  }

  // 2. Format stories for the prompt
  const formattedStories = stories
    .map((s, i) => formatStoryForPrompt(s, i + 1))
    .join('\n\n');

  // 3. Call the LLM
  try {
    const { executeLLM } = await import('@kit/prompt-engine/server');

    const result = await executeLLM<
      Omit<EpisodeRundown, 'breakPositions'> & { breakPositions?: unknown }
    >({
      templateSlug: 'news-generation/producer-role',
      variables: {
        episodeTitle: escapeXml(episodeTitle),
        totalDuration: String(totalDuration),
        stories: escapeXml(formattedStories),
      },
      context: {
        name: 'producer-role',
        accountId,
      },
    });

    const rundown = result.data.rundown ?? [];
    const totalRuntime = result.data.totalRuntime ?? totalDuration * 60;

    return {
      rundown,
      totalRuntime,
      breakPositions: resolveBreakPositions(
        rundown,
        totalRuntime,
        result.data.breakPositions,
      ),
    };
  } catch (err) {
    console.error('[producer-service] Failed to plan rundown:', err);

    return buildFallbackRundown(totalDuration);
  }
}

/**
 * Orchestrate a full news episode: plan rundown then generate each segment.
 *
 * Flow: planEpisodeRundown → generateNewsSegment for each segment
 */
export async function orchestrateNewsEpisode(
  options: OrchestrateEpisodeOptions,
): Promise<OrchestratedEpisode> {
  const { episodeTitle, accountId } = options;

  // 1. Plan the rundown
  const rundown = await planEpisodeRundown(options);

  // 2. Generate each segment sequentially (order matters for continuity)
  const { generateNewsSegment } = await import('./anchor-service');

  const segments: OrchestratedSegment[] = [];

  for (const item of rundown.rundown) {
    try {
      const script = await generateNewsSegment({
        episodeTitle,
        segmentTheme: item.title,
        targetDuration: item.duration,
        searchQuery: sanitizeSearchQuery(item.searchQuery),
        accountId,
      });

      segments.push({ ...item, script });
    } catch (err) {
      console.error(
        `[producer-service] Failed to generate segment ${item.segmentNumber}:`,
        err,
      );

      // Push a fallback segment so the episode still has content
      segments.push({
        ...item,
        script: {
          script: [
            {
              type: 'ANCHOR',
              content: 'Coverage for this segment is temporarily unavailable.',
              durationSeconds: FALLBACK_SEGMENT_DURATION_SECONDS,
            },
          ],
          sourcesUsed: [],
        },
      });
    }
  }

  return { rundown, segments };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Format a StoryCluster into a text block for the LLM prompt */
function formatStoryForPrompt(story: StoryCluster, index: number): string {
  const category = inferCategory(story.headline);
  const importance =
    story.importance >= HIGH_IMPORTANCE_THRESHOLD
      ? 'high'
      : story.importance >= MEDIUM_IMPORTANCE_THRESHOLD
        ? 'medium'
        : 'low';
  const articleCount = story.articles.length;

  return [
    `[${index}] ${story.headline}`,
    `Topic: ${story.topic} | Category: ${category} | Importance: ${importance} | Sources: ${articleCount}`,
  ].join('\n');
}

/**
 * Infer a broad category from a headline.
 * Used to provide category hints to the LLM.
 * @internal Exported for unit testing.
 */
export function inferCategory(headline: string): string {
  const lower = headline.toLowerCase();

  if (lower.includes('breaking') || lower.includes('urgent')) {
    return 'breaking';
  }

  if (
    lower.includes('election') ||
    lower.includes('congress') ||
    lower.includes('president') ||
    lower.includes('government')
  ) {
    return 'politics';
  }

  if (
    lower.includes('market') ||
    lower.includes('economy') ||
    lower.includes('stock') ||
    lower.includes('trade')
  ) {
    return 'business';
  }

  if (
    lower.includes('ai') ||
    lower.includes('tech') ||
    lower.includes('cyber') ||
    lower.includes('software')
  ) {
    return 'tech';
  }

  if (
    lower.includes('health') ||
    lower.includes('medical') ||
    lower.includes('vaccine') ||
    lower.includes('disease')
  ) {
    return 'health';
  }

  return 'feature';
}

/**
 * Build a fallback rundown when no stories are available or LLM fails.
 * Creates a single generic segment for the full duration.
 */
function buildFallbackRundown(totalDurationMinutes: number): EpisodeRundown {
  const totalSeconds = totalDurationMinutes * 60;

  return {
    rundown: [
      {
        segmentNumber: 1,
        title: 'General News Roundup',
        duration: totalSeconds,
        category: 'feature',
        searchQuery: 'latest news today',
        priority: 'medium',
      },
    ],
    totalRuntime: totalSeconds,
    breakPositions: [],
  };
}

/**
 * How many breaks a runtime carries: one per full `BREAK_INTERVAL_SECONDS`,
 * and never more than there are gaps between segments.
 * @internal Exported for unit testing.
 */
export function breakCountFor(
  totalRuntimeSeconds: number,
  segmentCount: number,
): number {
  return Math.max(
    0,
    Math.min(
      Math.floor(totalRuntimeSeconds / BREAK_INTERVAL_SECONDS),
      segmentCount - 1,
    ),
  );
}

/**
 * Break positions for a rundown: the LLM's own when they are usable, else
 * computed. Usable means the right count for the runtime, each a distinct
 * segment of the rundown that is not the last. Anything else is replaced by
 * `computeBreakPositions`, so the same rundown always gets the same breaks.
 * @internal Exported for unit testing.
 */
export function resolveBreakPositions(
  rundown: RundownSegment[],
  totalRuntimeSeconds: number,
  proposed: unknown,
): number[] {
  const count = breakCountFor(totalRuntimeSeconds, rundown.length);

  if (Array.isArray(proposed)) {
    const followable = new Set(
      rundown.slice(0, -1).map((segment) => segment.segmentNumber),
    );
    const usable = [
      ...new Set(
        proposed.filter(
          (value): value is number =>
            typeof value === 'number' && followable.has(value),
        ),
      ),
    ].sort((a, b) => a - b);

    if (usable.length === count && usable.length === proposed.length) {
      return usable;
    }
  }

  return computeBreakPositions(rundown, count);
}

/**
 * Spaces `count` breaks evenly through the rundown's running time, each at
 * the segment boundary nearest its target time (the earlier one on a tie),
 * without using a boundary twice.
 * @internal Exported for unit testing.
 */
export function computeBreakPositions(
  rundown: RundownSegment[],
  count: number,
): number[] {
  const boundaries = rundown.slice(0, -1).reduce<
    Array<{ segmentNumber: number; endsAt: number }>
  >((acc, segment) => {
    const previous = acc.at(-1)?.endsAt ?? 0;
    acc.push({
      segmentNumber: segment.segmentNumber,
      endsAt: previous + segment.duration,
    });
    return acc;
  }, []);

  const total = rundown.reduce((sum, segment) => sum + segment.duration, 0);
  const chosen: number[] = [];

  for (let k = 1; k <= count && chosen.length < boundaries.length; k++) {
    const target = (k * total) / (count + 1);
    const nearest = boundaries
      .filter((b) => !chosen.includes(b.segmentNumber))
      .reduce((best, b) =>
        Math.abs(b.endsAt - target) < Math.abs(best.endsAt - target) ? b : best,
      );
    chosen.push(nearest.segmentNumber);
  }

  return chosen.sort((a, b) => a - b);
}

/**
 * Sanitize an LLM-generated search query before passing to downstream services.
 *
 * LLM output is untrusted — it could contain injection payloads targeting the
 * search aggregator (e.g. SSRF via crafted URLs, SQL fragments, etc.). This
 * function strips everything except safe characters and truncates to a
 * reasonable length.
 */
export function sanitizeSearchQuery(raw: string): string {
  // Allow only alphanumeric, spaces, hyphens, and basic punctuation
  const cleaned = raw.replace(/[^a-zA-Z0-9\s\-',.]/g, '').trim();

  if (cleaned.length === 0) {
    return 'latest news today';
  }

  return cleaned.slice(0, MAX_SEARCH_QUERY_LENGTH);
}
