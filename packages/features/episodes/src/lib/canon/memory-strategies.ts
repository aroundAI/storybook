/**
 * Memory Strategies
 * Phase 11.2: FILM-1111
 *
 * Content-type-specific memory allocation, decay functions,
 * and priority scoring for the Memory Context Builder.
 */
import type { ProjectType } from '@kit/film-studio-schemas/project';

import {
  type ContentTypeConfig,
  type DecayFunction,
  getContentTypeConfig,
} from './content-type-configs';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Memory allocation breakdown per content type.
 * Values are percentages that must sum to 100.
 */
export interface MemoryAllocation {
  immutableEvents: number;
  characterStates: number;
  worldStates: number;
  narrativeThreads: number;
  episodeSummaries: number;
  parentContext: number;
  sourcesCitations: number;
}

/**
 * Memory context options resolved for a content type
 */
export interface ContentTypeMemoryOptions {
  maxTokenPercentage: number;
  contextWindowSize: number;
  memoryHorizon: number;
  allocation: MemoryAllocation;
  decayFunction: DecayFunction;
  includeParentContext: boolean;
  includeSources: boolean;
}

/**
 * Priority score for memory context inclusion
 */
export interface PriorityScore {
  /** Score between 0 and 1 */
  score: number;
  /** Human-readable explanation */
  reason: string;
  /** Whether to include in context */
  include: boolean;
}

// =============================================================================
// MEMORY ALLOCATIONS
// =============================================================================

/**
 * Default memory allocations per content type.
 *
 * These map to the token budget categories in the Memory Context Builder.
 * Values are percentages that must sum to 100.
 */
export const MEMORY_ALLOCATIONS: Record<ProjectType, MemoryAllocation> = {
  'short-film': {
    immutableEvents: 30,
    characterStates: 30,
    worldStates: 10,
    narrativeThreads: 15,
    episodeSummaries: 15,
    parentContext: 0,
    sourcesCitations: 0,
  },

  series: {
    immutableEvents: 35,
    characterStates: 25,
    worldStates: 10,
    narrativeThreads: 20,
    episodeSummaries: 10,
    parentContext: 0,
    sourcesCitations: 0,
  },

  documentary: {
    immutableEvents: 10,
    characterStates: 5,
    worldStates: 5,
    narrativeThreads: 10,
    episodeSummaries: 20,
    parentContext: 0,
    sourcesCitations: 50,
  },

  educational: {
    immutableEvents: 15,
    characterStates: 15,
    worldStates: 10,
    narrativeThreads: 15,
    episodeSummaries: 15,
    parentContext: 0,
    sourcesCitations: 30,
  },

  ad: {
    immutableEvents: 20,
    characterStates: 40,
    worldStates: 15,
    narrativeThreads: 10,
    episodeSummaries: 15,
    parentContext: 0,
    sourcesCitations: 0,
  },

  news: {
    immutableEvents: 0,
    characterStates: 0,
    worldStates: 0,
    narrativeThreads: 0,
    episodeSummaries: 0,
    parentContext: 0,
    sourcesCitations: 100,
  },
};

// =============================================================================
// DECAY FUNCTIONS
// =============================================================================

/** Minimum priority threshold for inclusion */
const MIN_PRIORITY_THRESHOLD = 0.1;

/**
 * Get decay factor for a given episode distance.
 *
 * Controls how quickly older episodes lose relevance:
 * - `short-film`: Linear decay (movie acts lose context gradually)
 * - `series`: Gentle exponential (keep broad history, 0.95^n)
 * - `documentary`/`educational`: No distance decay (topic relevance instead)
 * - `ad`: No decay (single-instance, no history)
 * - `news`: Zero (no history at all)
 */
export function getDecayFactor(
  projectType: ProjectType,
  episodeDistance: number,
): number {
  switch (projectType) {
    case 'short-film':
      // Linear decay clamped at 0.3
      return Math.max(0.3, 1 - episodeDistance * 0.1);

    case 'series':
      // Gentle exponential — retain history across long series
      return Math.pow(0.95, episodeDistance);

    case 'documentary':
    case 'educational':
      // No distance-based decay; topic relevance drives inclusion
      return 1.0;

    case 'ad':
      // Minimal memory, slight decay
      return Math.max(0.5, 1 - episodeDistance * 0.2);

    case 'news':
      // No history at all
      return 0;

    default:
      return Math.pow(0.9, episodeDistance);
  }
}

// =============================================================================
// MEMORY OPTIONS
// =============================================================================

const DEFAULT_CONTEXT_WINDOW_SIZE = 40_000;

/**
 * Get full memory options for a content type.
 *
 * Combines the content type config, allocation, and decay function
 * into a single options object that `buildMemoryContext` can consume.
 */
export function getMemoryOptionsForContentType(
  projectType: ProjectType,
  contextWindowSize = DEFAULT_CONTEXT_WINDOW_SIZE,
): ContentTypeMemoryOptions {
  const config: ContentTypeConfig = getContentTypeConfig(projectType);
  const allocation = MEMORY_ALLOCATIONS[projectType];
  if (!allocation) {
    return getMemoryOptionsForContentType('series', contextWindowSize);
  }

  return {
    maxTokenPercentage: config.contextWindowPercent,
    contextWindowSize,
    memoryHorizon: config.memoryHorizon,
    allocation,
    decayFunction: config.decayFunction,
    includeParentContext: allocation.parentContext > 0,
    includeSources: config.requiresFacts || config.requiresExternalContext,
  };
}

// =============================================================================
// PRIORITY SCORING
// =============================================================================

/**
 * Calculate priority score for a memory context item.
 *
 * Score is between 0 and 1, combining:
 * - Recency (distance-based decay)
 * - Importance (0-10 optional boost)
 * - Frequency (mention count boost)
 */
export function calculatePriority(
  item: {
    createdAt: Date;
    importance?: number;
    mentions?: number;
  },
  currentEpisode: number,
  itemEpisode: number,
  projectType: ProjectType,
): PriorityScore {
  const distance = currentEpisode - itemEpisode;
  const decayFactor = getDecayFactor(projectType, distance);

  // Base score from recency
  let score = decayFactor;

  // Boost for importance (weighted blend)
  if (item.importance !== undefined && item.importance > 0) {
    score = score * 0.6 + (item.importance / 10) * 0.4;
  }

  // Boost for frequently mentioned items (cap at 1.0)
  if (item.mentions !== undefined && item.mentions > 3) {
    score = Math.min(1.0, score * 1.2);
  }

  const include = score > MIN_PRIORITY_THRESHOLD;

  return {
    score,
    reason: `decay=${decayFactor.toFixed(2)}, distance=${distance}`,
    include,
  };
}
