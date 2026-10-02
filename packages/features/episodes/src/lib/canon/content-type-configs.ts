/**
 * Content Type Configurations
 * Phase 11.2: FILM-1110
 *
 * Maps each ProjectType to canon management rules, memory strategies,
 * validation behaviors, and LLM role pipelines.
 */
import type { ProjectType } from '@kit/film-studio-schemas/project';

// =============================================================================
// TYPES
// =============================================================================

export type DecayFunction = 'linear' | 'exponential' | 'topic_match' | 'none';

export interface ContentTypeConfig {
  /** Number of episodes/acts to include in memory context */
  memoryHorizon: number;

  /**
   * How memory priority decays with episode distance. Names the curve
   * `getDecayFactor` computes for the type (memory-strategies.ts); a test
   * holds the two together.
   */
  decayFunction: DecayFunction;

  /** Token budget percentage of context window for memory */
  contextWindowPercent: number;

  /** Validation strictness for continuity checks */
  enforcement: 'strict' | 'flexible' | 'none';

  /** Whether verified facts are required for generation */
  requiresFacts: boolean;

  /** Whether external context providers (news APIs, research) are used */
  requiresExternalContext: boolean;

  /** LLM roles for generation pipeline */
  roles: string[];
}

// =============================================================================
// CONFIGS
// =============================================================================

/**
 * Configuration mapping for each project type.
 *
 * Token allocation per category lives in one place, `MEMORY_ALLOCATIONS`
 * (memory-strategies.ts, FILM-1111).
 */
export const CONTENT_TYPE_CONFIGS: Record<ProjectType, ContentTypeConfig> = {
  'short-film': {
    memoryHorizon: 10,
    decayFunction: 'linear',
    contextWindowPercent: 15,
    enforcement: 'strict',
    requiresFacts: false,
    requiresExternalContext: false,
    roles: ['planner', 'writer', 'editor', 'stylist'],
  },

  series: {
    memoryHorizon: 50,
    decayFunction: 'exponential',
    contextWindowPercent: 18,
    enforcement: 'strict',
    requiresFacts: false,
    requiresExternalContext: false,
    roles: ['planner', 'writer', 'editor', 'stylist'],
  },

  movie: {
    memoryHorizon: 3,
    decayFunction: 'none',
    contextWindowPercent: 20,
    enforcement: 'strict',
    requiresFacts: false,
    requiresExternalContext: false,
    roles: ['planner', 'writer', 'editor', 'stylist'],
  },

  documentary: {
    memoryHorizon: 5,
    decayFunction: 'topic_match',
    contextWindowPercent: 10,
    enforcement: 'strict',
    requiresFacts: true,
    requiresExternalContext: true,
    roles: ['researcher', 'fact-checker', 'writer', 'stylist'],
  },

  educational: {
    memoryHorizon: 5,
    decayFunction: 'topic_match',
    contextWindowPercent: 12,
    enforcement: 'flexible',
    requiresFacts: true,
    requiresExternalContext: false,
    roles: ['researcher', 'writer', 'editor', 'stylist'],
  },

  ad: {
    memoryHorizon: 1,
    decayFunction: 'linear',
    contextWindowPercent: 10,
    enforcement: 'flexible',
    requiresFacts: false,
    requiresExternalContext: false,
    roles: ['writer', 'stylist'],
  },

  news: {
    memoryHorizon: 1,
    decayFunction: 'none',
    contextWindowPercent: 5,
    enforcement: 'strict',
    requiresFacts: true,
    requiresExternalContext: true,
    roles: ['aggregator', 'fact-checker', 'anchor', 'producer'],
  },
};

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Get configuration for a project type.
 * Falls back to `series` config if the type is unknown.
 */
export function getContentTypeConfig(
  projectType: ProjectType,
): ContentTypeConfig {
  const config = CONTENT_TYPE_CONFIGS[projectType];
  if (!config) {
    return CONTENT_TYPE_CONFIGS.series;
  }
  return config;
}

/** Short display names, e.g. "Memory Horizon: 1 episode (automatic, Ad)". */
export const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  'short-film': 'Short film',
  series: 'Series',
  movie: 'Movie',
  documentary: 'Documentary',
  ad: 'Ad',
  educational: 'Educational',
  news: 'News',
};

/**
 * The project type resolver lives in `@kit/generation` (FILM-1901), where the
 * season stages read it without this package; re-exported so every reader
 * of `@kit/episodes/lib` keeps its import.
 */
export {
  DEFAULT_PROJECT_TYPE,
  type ProjectTypeSource,
  resolveProjectType,
} from '@kit/generation/project-type';
