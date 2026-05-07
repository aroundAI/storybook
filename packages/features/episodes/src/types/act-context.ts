/**
 * Act Context Bridge Types
 * FILM-1112: Movie act continuity system
 *
 * Captures the complete narrative state at the end of each movie act
 * and provides it as context to the next act's generation.
 */

// =============================================================================
// CORE BRIDGE TYPE
// =============================================================================

/**
 * Complete state captured at the end of an act.
 * This becomes the "memory" injected into the next act's generation.
 */
export interface ActContextBridge {
  /** Episode ID (movie treated as single episode) */
  movieId: string;
  /** Act number (1-5) */
  actNumber: number;
  /** Human-readable act title, e.g. "Setup", "Confrontation" */
  actTitle: string;

  // Timing
  /** Seconds into movie where act starts */
  actStartTime: number;
  /** Seconds into movie where act ends */
  actEndTime: number;

  // Character state at act end
  /** Character IDs still alive */
  charactersAlive: string[];
  /** Detailed per-character state */
  characterStates: Record<string, CharacterActState>;

  // Plot continuity
  /** Thread IDs still open */
  openThreads: string[];
  /** Threads resolved during this act */
  resolvedThreads: string[];
  /** Narrative promises (setups) made */
  promises: PlotPromise[];

  // Physical continuity
  /** Current location state */
  currentLocation: LocationState;
  /** Props established and visible */
  establishedProps: string[];
  /** Time of day at act end */
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night';
  /** Current weather/atmospheric condition */
  weatherCondition: string;

  // Emotional/tonal continuity
  /** Multi-dimensional tone vector */
  toneVector: ToneVector;
  /** Stakes level at act end (1-10) */
  stakesLevel: number;
  /** Tension level at act end (1-10) */
  tensionLevel: number;

  // Directives for next act
  /** Thread IDs that MUST be addressed next */
  mustResolve: string[];
  /** Character IDs that are dead — DO NOT include */
  mustNotInclude: string[];
  /** Promise IDs needing resolution */
  setupsToPayoff: string[];
  /** Summary paragraph for LLM carry-forward */
  carryForwardContext: string;
}

// =============================================================================
// SUPPORTING TYPES
// =============================================================================

/** Per-character state at the end of an act */
export interface CharacterActState {
  characterId: string;
  characterName: string;

  // Status
  isAlive: boolean;
  location: string;

  // Emotional arc
  emotionalState: string;
  /** 1-10 intensity scale */
  emotionalIntensity: number;

  // Knowledge
  /** Facts this character knows */
  knowsFacts: string[];
  /** Important things this character does NOT know */
  doesNotKnow: string[];

  // Relationship changes during this act
  relationshipChanges: RelationshipChange[];

  // Physical state
  injuries: string[];
  appearance: string;
  /** Props the character has */
  hasProps: string[];
}

export interface RelationshipChange {
  targetCharacterId: string;
  fromState: string;
  toState: string;
}

/** A narrative promise (Chekhov's gun) */
export interface PlotPromise {
  id: string;
  description: string;
  /** Which act this promise was made in */
  madeInAct: number;
  /** Which act should resolve this */
  expectedPayoffAct: number;
  priority: 'critical' | 'major' | 'minor';
}

/** Location state at act end */
export interface LocationState {
  locationId: string;
  locationName: string;
  isDestroyed: boolean;
  presentCharacters: string[];
  /** Visual details: "Rain on windows", "Fire in hearth" */
  establishedDetails: string[];
}

/** Multi-axis tone vector (all values 0-1) */
export interface ToneVector {
  humor: number;
  darkness: number;
  romance: number;
  action: number;
  suspense: number;
}
