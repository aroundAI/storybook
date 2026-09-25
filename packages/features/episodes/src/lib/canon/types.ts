/**
 * Canon Management System Types
 * Phase 10: FILM-1001 to FILM-1006
 *
 * TypeScript interfaces for narrative continuity enforcement.
 */
import type { ProjectType } from '@kit/film-studio-schemas/project';

import type { DecayFunction, ProjectTypeSource } from './content-type-configs';
import type { MemoryHorizonMode, MemoryHorizonSource } from './memory-horizon';

// =============================================================================
// DATABASE ENTITY TYPES (matching Supabase schema)
// =============================================================================

/**
 * Immutable events that CANNOT be contradicted.
 * Generation will FAIL HARD if violated.
 */
export interface ImmutableEvent {
  id: string;
  projectId: string;
  eventType: ImmutableEventType;
  eventKey: string;
  establishedIn: string;
  season: number;
  episodeNumber: number;
  description: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  createdBy?: string;
}

export type ImmutableEventType =
  | 'death'
  | 'world_fact'
  | 'relationship'
  | 'timeline'
  | 'ability_loss'
  | 'location_destruction';

/**
 * Character state in append-only log.
 * Forward-only changes - reversals are violations.
 */
export interface CharacterState {
  id: string;
  characterId: string;
  episodeId: string;
  stateType: CharacterStateType;
  stateValue: CharacterStateValue;
  triggerEvent: string;
  cost?: string;
  newConstraints?: string[];
  previousStateId?: string;
  createdAt: string;
  createdBy?: string;
}

export type CharacterStateType =
  | 'emotional'
  | 'physical'
  | 'relationship'
  | 'knowledge'
  | 'ability'
  | 'location'
  | 'goal';

export type CharacterStateValue = Record<string, unknown>;

/**
 * World/environment state tracking.
 */
export interface WorldState {
  id: string;
  projectId: string;
  episodeId: string;
  location: string;
  timePeriod?: string;
  activeConflicts?: string[];
  atmosphere?: string;
  constraints?: string[];
  environmentData?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/**
 * Narrative thread for plot tracking.
 * Tracks setups and payoffs to prevent orphaned threads.
 */
export interface EpisodeRef {
  id: string;
  title: string;
  number: number;
}

export interface NarrativeThread {
  id: string;
  projectId: string;
  threadName: string;
  threadType: NarrativeThreadType;
  status: NarrativeThreadStatus;
  openedAt: string;
  resolvedAt?: string;
  episodesTouched?: string[];
  promises?: string[];
  payoffs?: string[];
  description?: string;
  createdAt: string;
  updatedAt: string;
  openedEpisode?: EpisodeRef;
  resolvedEpisode?: EpisodeRef;
  /**
   * The latest episode number the thread was opened or touched in. Set by
   * the memory context builder; undefined when none of its episodes resolve.
   */
  lastActiveEpisodeNumber?: number;
}

export type NarrativeThreadType =
  | 'plot'
  | 'character'
  | 'mystery'
  | 'romantic'
  | 'conflict'
  | 'thematic';

export type NarrativeThreadStatus =
  | 'open'
  | 'progressed'
  | 'resolved'
  | 'abandoned';

/**
 * State delta for audit trail.
 * Immutable log of all state changes per episode.
 */
export interface StateDelta {
  id: string;
  episodeId: string;
  entityType: 'character' | 'world' | 'thread' | 'immutable';
  entityId: string;
  beforeState?: Record<string, unknown>;
  afterState?: Record<string, unknown>;
  changeReason?: string;
  sceneNumber?: number;
  createdAt: string;
}

/**
 * Episode summary for memory context.
 * Pre-computed summaries for efficient context injection.
 */
export interface EpisodeSummary {
  id: string;
  episodeId: string;
  plotSummary: string;
  keyEvents?: string[];
  characterChanges?: string[];
  newConstraints?: string[];
  sentimentScore?: number;
  estimatedTokens?: number;
  createdAt: string;
  updatedAt: string;
}

// =============================================================================
// MEMORY CONTEXT TYPES (FILM-1004)
// =============================================================================

/**
 * Token budget allocation for memory context.
 * 15% of total token budget by default.
 */
export interface TokenBudget {
  total: number;
  allocated: number;
  remaining: number;
  byCategory: {
    immutableEvents: number;
    characterStates: number;
    episodeSummaries: number;
    narrativeThreads: number;
    worldStates: number;
    sourcesCitations: number;
  };
}

/**
 * A verified fact loaded into the memory context as a source (FILM-1111).
 * Only facts with `verification_status = 'verified'` are loaded.
 */
export interface SourceCitation {
  factId: string;
  claim: string;
  citation?: string;
  sourceTitle?: string;
  category?: string;
  confidence?: number;
}

/**
 * Memory context for LLM generation.
 * Built by MemoryContextBuilder.
 */
export interface MemoryContext {
  projectId: string;
  episodeNumber: number;
  tokenBudget: TokenBudget;
  immutableEvents: ImmutableEvent[];
  characterStates: CharacterStateContext[];
  activeThreads: NarrativeThread[];
  recentSummaries: EpisodeSummary[];
  worldState?: WorldState;
  /** Verified facts, for types with a source budget (FILM-1111) */
  sources: SourceCitation[];
  metadata: {
    builtAt: string;
    /** The content type the budgets and horizon were taken from (FILM-1110) */
    projectType: ProjectType;
    projectTypeSource: ProjectTypeSource;
    memoryHorizon: number;
    memoryHorizonSource: MemoryHorizonSource;
    /** The decay threads, characters and summaries were ranked with (FILM-1111) */
    decayFunction: DecayFunction;
    /** Token budget per category, before loading */
    budgets: MemoryBudgets;
    totalTokensUsed: number;
  };
}

/**
 * Token budget per category. `sourcesCitations` is filled with verified
 * facts (FILM-1111); `parentContext` is reserved for sequels (FILM-1113) and
 * not yet filled.
 */
export interface MemoryBudgets {
  immutableEvents: number;
  characterStates: number;
  worldStates: number;
  narrativeThreads: number;
  episodeSummaries: number;
  parentContext: number;
  sourcesCitations: number;
}

/**
 * Character state context with computed fields.
 */
export interface CharacterStateContext {
  characterId: string;
  characterName: string;
  currentStates: CharacterState[];
  constraints: string[];
  arc?: string;
}

// =============================================================================
// CONTINUITY VALIDATION TYPES (FILM-1003)
// =============================================================================

/**
 * Violation codes for continuity rules.
 */
export type ViolationCode =
  | 'CANON_001' // Resurrection Failure
  | 'CANON_002' // State Reversal
  | 'CANON_003' // Knowledge Violation
  | 'CANON_004' // Authorization Missing
  | 'CANON_005' // World Contradiction
  | 'CANON_006' // Reference Violation
  | 'CANON_007' // Connectivity Failure
  | 'CANON_008' // Escalation Overflow
  | 'CANON_009' // Tone Drift
  | 'CANON_010'; // Planner Output Malformed

/**
 * Severity levels for violations.
 */
export type ViolationSeverity = 'error' | 'warning' | 'info';

/**
 * A single continuity violation.
 */
export interface ContinuityViolation {
  code: ViolationCode;
  severity: ViolationSeverity;
  message: string;
  location?: {
    sceneNumber?: number;
    lineNumber?: number;
    characterId?: string;
  };
  suggestion?: string;
  relatedEvents?: string[];
}

/**
 * Result of continuity validation.
 */
export interface ContinuityValidationResult {
  valid: boolean;
  violations: ContinuityViolation[];
  passedRules: ViolationCode[];
  summary: {
    errors: number;
    warnings: number;
    infos: number;
  };
  validatedAt: string;
}

/**
 * Validation checkpoint in workflow.
 */
export type ValidationCheckpoint =
  | 'IDEATION'
  | 'STORY'
  | 'SCREENPLAY'
  | 'PUBLISH';

/**
 * Plot skeleton for validation at STORY checkpoint.
 */
export interface PlotSkeleton {
  premise: string;
  scenes: PlotScene[];
  characters: PlotCharacter[];
  episodeNumber: number;
}

export interface PlotScene {
  sceneNumber: number;
  summary: string;
  location?: string;
  charactersPresent: string[];
  keyEvents?: string[];
}

export interface PlotCharacter {
  characterId: string;
  name: string;
  role: string;
  emotionalArc?: string;
}

// =============================================================================
// LLM ROLE SEPARATION TYPES (FILM-1006)
// =============================================================================

/**
 * LLM roles in the generation pipeline.
 */
export type LLMRole = 'planner' | 'writer' | 'editor' | 'stylist';

/**
 * Role permissions matrix.
 */
export interface RolePermissions {
  canModifyStructure: boolean;
  canModifyPlot: boolean;
  canModifyDialogue: boolean;
  canModifyStyle: boolean;
  canModifyLength: boolean;
}

export const ROLE_PERMISSIONS: Record<LLMRole, RolePermissions> = {
  planner: {
    canModifyStructure: true,
    canModifyPlot: true,
    canModifyDialogue: false,
    canModifyStyle: false,
    canModifyLength: true,
  },
  writer: {
    canModifyStructure: false,
    canModifyPlot: false,
    canModifyDialogue: true,
    canModifyStyle: true,
    canModifyLength: true,
  },
  editor: {
    canModifyStructure: false,
    canModifyPlot: false,
    canModifyDialogue: true,
    canModifyStyle: true,
    canModifyLength: false,
  },
  stylist: {
    canModifyStructure: false,
    canModifyPlot: false,
    canModifyDialogue: false,
    canModifyStyle: true,
    canModifyLength: false,
  },
};

/**
 * Role execution context.
 */
export interface RoleExecutionContext {
  role: LLMRole;
  constraints: string[];
  previousOutput?: string;
  memoryContext: MemoryContext;
}

/**
 * Role execution result.
 */
export interface RoleExecutionResult {
  role: LLMRole;
  output: string;
  validationResult: ContinuityValidationResult;
  tokenUsage: number;
  executedAt: string;
}

// =============================================================================
// CANON SETTINGS TYPES (Project Configuration)
// =============================================================================

/**
 * Canon settings stored in projects.metadata.canon
 */
export interface CanonSettings {
  enabled: boolean;
  roleSeparation: boolean;
  /**
   * Episodes of history to include, when the user chose a number; `null`
   * means automatic (the content type's horizon). Read it through
   * `savedMemoryHorizonOverride`, which also handles saves from before
   * `memoryHorizonMode` existed.
   */
  memoryHorizon: number | null;
  /** Absent on settings saved before FILM-1110. */
  memoryHorizonMode?: MemoryHorizonMode;
  enforcement: 'flexible' | 'strict';
}

export const DEFAULT_CANON_SETTINGS: CanonSettings = {
  enabled: false,
  roleSeparation: false,
  memoryHorizon: null,
  memoryHorizonMode: 'automatic',
  enforcement: 'flexible',
};

// =============================================================================
// CANON HEALTH TYPES (Dashboard)
// =============================================================================

/**
 * Canon health status for dashboard.
 */
export interface CanonHealthStatus {
  status: 'ok' | 'warning' | 'error';
  issueCount: number;
  lastValidation: string;
}

/**
 * Canon statistics for dashboard.
 */
export interface CanonStats {
  immutableEvents: number;
  activeThreads: number;
  characterArcs: number;
  lastEpisode: number;
}

/**
 * Canon dashboard data.
 */
export interface CanonDashboardData {
  health: CanonHealthStatus;
  stats: CanonStats;
  config: CanonSettings;
  orphanedThreads?: NarrativeThread[];
  recentViolations?: ContinuityViolation[];
}

// =============================================================================
// INPUT TYPES (for server actions)
// =============================================================================

export interface AddImmutableEventInput {
  projectId: string;
  eventType: ImmutableEventType;
  eventKey: string;
  establishedIn: string;
  season: number;
  episodeNumber: number;
  description: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateCharacterStateInput {
  characterId: string;
  episodeId: string;
  stateType: CharacterStateType;
  stateValue: CharacterStateValue;
  triggerEvent: string;
  cost?: string;
  newConstraints?: string[];
}

export interface CreateNarrativeThreadInput {
  projectId: string;
  threadName: string;
  threadType: NarrativeThreadType;
  openedAt: string;
  description?: string;
  promises?: string[];
}

export interface BuildMemoryContextInput {
  projectId: string;
  episodeNumber: number;
  tokenBudgetPercent?: number;
  memoryHorizon?: number;
  /** When provided, uses content-type-specific allocations and horizon */
  projectType?: ProjectType;
}
