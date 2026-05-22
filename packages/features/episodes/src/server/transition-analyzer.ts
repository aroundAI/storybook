/**
 * Transition Analyzer & Frame Chain Resolver
 *
 * Bridges the #1 human judgment gap: deciding whether a shot is a
 * "continuation" (reuse previous shot's last frame) or a "cut"
 * (generate a new first frame).
 *
 * Also resolves the frame chain — walking all shots in sequence order
 * and computing which shots inherit frames from their predecessor.
 */
import { ShotMetadataSchema } from '../lib/schemas/shot-list.schema';
import type {
  FrameStrategy,
  PrimarySubject,
  Shot,
  TransitionType,
} from '../lib/types';

// Helper: safely parse shot metadata JSONB at the boundary
function parseMetadata(shot: Shot) {
  return ShotMetadataSchema.nullish().parse(shot.metadata);
}

// ============================================================================
// Types
// ============================================================================

export interface TransitionAnalysis {
  shotId: string;
  sequenceNumber: number;
  transitionType: TransitionType;
  inheritLastFrame: boolean;
  continuationFromShotId: string | null;
  frameStrategy: FrameStrategy;
  primarySubject: PrimarySubject;
}

export interface FrameChainEntry {
  shotId: string;
  sequenceNumber: number;
  sceneNumber: number;
  shotNumber: number;
  /** Where the first frame comes from */
  firstFrameSource: 'generated' | 'inherited';
  /** If inherited, which shot's last frame to use */
  inheritFromShotId: string | null;
  /** If inherited, the URL to copy */
  inheritFromLastFrameUrl: string | null;
  /** Description for generating a new first frame (when source = 'generated') */
  firstFrameDescription: string | null;
  /** Description for generating the last frame */
  lastFrameDescription: string | null;
  /** Frame composition strategy */
  frameStrategy: FrameStrategy;
  /** What the camera focuses on */
  primarySubject: PrimarySubject;
}

export interface FrameGenerationTask {
  shotId: string;
  sequenceNumber: number;
  type: 'first_frame' | 'last_frame';
  description: string;
  frameStrategy: FrameStrategy;
  primarySubject: PrimarySubject;
  /** Location reference image URL (style reference for Flow) */
  locationImageUrl: string | null;
  /** Character reference image URLs */
  characterImageUrls: Array<{ name: string; url: string }>;
}

// ============================================================================
// Shot types that indicate character-focused framing
// ============================================================================

const CHARACTER_FOCUS_SHOT_TYPES = new Set([
  'close-up',
  'extreme-close-up',
  'medium-close-up',
  'profile',
  'three-quarter',
  'reaction',
]);

const TWO_SHOT_TYPES = new Set(['two-shot', 'over-shoulder']);

const GROUP_SHOT_TYPES = new Set(['three-shot', 'group-shot']);

const ENVIRONMENT_SHOT_TYPES = new Set([
  'wide',
  'extreme-wide',
  'medium-wide',
  'establishing',
  'bird-eye',
]);

const DETAIL_SHOT_TYPES = new Set(['insert', 'pov']);

// ============================================================================
// Core Analysis Functions
// ============================================================================

/**
 * Determines the frame strategy based on shot type and character count.
 * This replaces your manual judgment of "is this a closeup or a wide?"
 */
export function determineFrameStrategy(
  shotType: string,
  characterCount: number,
): FrameStrategy {
  if (DETAIL_SHOT_TYPES.has(shotType)) return 'detail_insert';
  if (CHARACTER_FOCUS_SHOT_TYPES.has(shotType) && characterCount >= 1)
    return 'character_focus';
  if (TWO_SHOT_TYPES.has(shotType) && characterCount >= 2) return 'two_shot';
  if (GROUP_SHOT_TYPES.has(shotType) && characterCount >= 3) return 'group';
  if (ENVIRONMENT_SHOT_TYPES.has(shotType)) return 'environment_focus';

  // Fallback: if there are characters and it's a medium shot, focus on character
  if (characterCount === 1) return 'character_focus';
  if (characterCount === 2) return 'two_shot';
  if (characterCount >= 3) return 'group';

  return 'environment_focus';
}

/**
 * Determines the primary subject of a shot.
 * This replaces your judgment of "who/what am I focusing on?"
 */
export function determinePrimarySubject(shot: Shot): PrimarySubject {
  const metadata = parseMetadata(shot);

  const characters = metadata?.characters ?? [];
  const shotType = metadata?.shotType ?? shot.cameraDirection ?? '';

  // Character-focused shot types → primary subject is first character
  if (CHARACTER_FOCUS_SHOT_TYPES.has(shotType) && characters.length >= 1) {
    return { type: 'character', name: characters[0]! };
  }

  // Two-shot → primary subject is first character (both are shown)
  if (TWO_SHOT_TYPES.has(shotType) && characters.length >= 1) {
    return { type: 'character', name: characters[0]! };
  }

  // Insert/POV → could be object or location
  if (DETAIL_SHOT_TYPES.has(shotType)) {
    return { type: 'object', name: shot.description.slice(0, 50) };
  }

  // Environment shots → location
  if (ENVIRONMENT_SHOT_TYPES.has(shotType)) {
    const location = parseMetadata(shot)?.location ?? 'scene';
    return { type: 'location', name: location };
  }

  // Default: if characters exist, focus on first character
  if (characters.length >= 1) {
    return { type: 'character', name: characters[0]! };
  }

  // No characters → location
  const location = parseMetadata(shot)?.location ?? 'scene';
  return { type: 'location', name: location };
}

/**
 * Analyzes the transition between two consecutive shots.
 * This is the core judgment function that replaces your manual decision.
 *
 * Rules:
 * 1. Different scene → always CUT
 * 2. Same scene + close-up/reaction after wide/medium → CUT (character focus)
 * 3. Same scene + same shot type + similar characters → CONTINUATION
 * 4. Same scene + matching camera movement direction → CONTINUATION
 * 5. Same scene + different character focus → CUT
 * 6. Default for same scene → CUT (safer to generate fresh frame)
 */
export function analyzeTransition(
  previousShot: Shot,
  currentShot: Shot,
): TransitionType {
  // Rule 1: Scene change = always cut
  if (previousShot.sceneNumber !== currentShot.sceneNumber) {
    return 'cut';
  }

  const prevMeta = parseMetadata(previousShot);
  const currMeta = parseMetadata(currentShot);

  const prevCharacters = new Set(
    (prevMeta?.characters ?? []).map((c) => c.toLowerCase()),
  );
  const currCharacters = new Set(
    (currMeta?.characters ?? []).map((c) => c.toLowerCase()),
  );

  const prevShotType = prevMeta?.shotType ?? '';
  const currShotType = currMeta?.shotType ?? '';

  // Rule 2: Shift from wide/medium to close-up = CUT
  if (
    ENVIRONMENT_SHOT_TYPES.has(prevShotType) &&
    CHARACTER_FOCUS_SHOT_TYPES.has(currShotType)
  ) {
    return 'cut';
  }

  // Rule 2b: Shift from close-up to wide = CUT
  if (
    CHARACTER_FOCUS_SHOT_TYPES.has(prevShotType) &&
    ENVIRONMENT_SHOT_TYPES.has(currShotType)
  ) {
    return 'cut';
  }

  // Rule 3: Same shot type + overlapping characters = CONTINUATION
  if (prevShotType === currShotType) {
    const overlap = [...prevCharacters].filter((c) => currCharacters.has(c));
    if (overlap.length > 0) {
      return 'continuation';
    }
  }

  // Rule 4: Tracking/dolly shots in same scene with same characters = CONTINUATION
  const prevShotLine = prevMeta?.veoPrompt?.shotLine?.toLowerCase() ?? '';
  const currShotLine = currMeta?.veoPrompt?.shotLine?.toLowerCase() ?? '';

  if (
    (prevShotLine.includes('tracking') || prevShotLine.includes('dolly')) &&
    (currShotLine.includes('tracking') || currShotLine.includes('dolly'))
  ) {
    const overlap = [...prevCharacters].filter((c) => currCharacters.has(c));
    if (overlap.length > 0) {
      return 'continuation';
    }
  }

  // Rule 5: Different character focus = CUT
  if (prevCharacters.size > 0 && currCharacters.size > 0) {
    const overlap = [...prevCharacters].filter((c) => currCharacters.has(c));
    if (overlap.length === 0) {
      return 'cut';
    }
  }

  // Rule 6: Same scene, medium shots, some overlap → likely continuation
  if (
    !ENVIRONMENT_SHOT_TYPES.has(currShotType) &&
    !CHARACTER_FOCUS_SHOT_TYPES.has(currShotType)
  ) {
    const overlap = [...prevCharacters].filter((c) => currCharacters.has(c));
    if (overlap.length > 0) {
      return 'continuation';
    }
  }

  // Default: CUT (safer — generates a fresh first frame)
  return 'cut';
}

/**
 * Analyzes all shots in an episode and determines transitions.
 * Returns transition analysis for each shot.
 */
export function analyzeAllTransitions(shots: Shot[]): TransitionAnalysis[] {
  const sorted = [...shots].sort(
    (a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0),
  );

  return sorted.map((shot, index) => {
    const parsedMeta = parseMetadata(shot);
    const characters = parsedMeta?.characters ?? [];
    const shotType = parsedMeta?.shotType ?? '';

    const frameStrategy = determineFrameStrategy(shotType, characters.length);
    const primarySubject = determinePrimarySubject(shot);

    if (index === 0) {
      // First shot is always a cut (no previous shot)
      return {
        shotId: shot.id,
        sequenceNumber: shot.sequenceNumber ?? index + 1,
        transitionType: 'cut' as TransitionType,
        inheritLastFrame: false,
        continuationFromShotId: null,
        frameStrategy,
        primarySubject,
      };
    }

    const previousShot = sorted[index - 1]!;
    const transitionType = analyzeTransition(previousShot, shot);
    const inheritLastFrame = transitionType === 'continuation';

    return {
      shotId: shot.id,
      sequenceNumber: shot.sequenceNumber ?? index + 1,
      transitionType,
      inheritLastFrame,
      continuationFromShotId: inheritLastFrame ? previousShot.id : null,
      frameStrategy,
      primarySubject,
    };
  });
}

/**
 * Resolves the frame chain for an episode.
 * Walks all shots in sequence and determines:
 * - Which shots need fresh first-frame generation
 * - Which shots inherit from the previous shot's last frame
 * - What image generation tasks are needed
 */
export function resolveFrameChain(shots: Shot[]): FrameChainEntry[] {
  const transitions = analyzeAllTransitions(shots);
  const shotMap = new Map(shots.map((s) => [s.id, s]));

  return transitions.map((t) => {
    const shot = shotMap.get(t.shotId)!;

    if (t.inheritLastFrame && t.continuationFromShotId) {
      const previousShot = shotMap.get(t.continuationFromShotId);
      return {
        shotId: t.shotId,
        sequenceNumber: t.sequenceNumber,
        sceneNumber: shot.sceneNumber,
        shotNumber: shot.shotNumber,
        firstFrameSource: 'inherited' as const,
        inheritFromShotId: t.continuationFromShotId,
        inheritFromLastFrameUrl: previousShot?.lastFrameUrl ?? null,
        firstFrameDescription: shot.firstFrameDescription ?? null,
        lastFrameDescription: shot.lastFrameDescription ?? null,
        frameStrategy: t.frameStrategy,
        primarySubject: t.primarySubject,
      };
    }

    return {
      shotId: t.shotId,
      sequenceNumber: t.sequenceNumber,
      sceneNumber: shot.sceneNumber,
      shotNumber: shot.shotNumber,
      firstFrameSource: 'generated' as const,
      inheritFromShotId: null,
      inheritFromLastFrameUrl: null,
      firstFrameDescription: shot.firstFrameDescription ?? null,
      lastFrameDescription: shot.lastFrameDescription ?? null,
      frameStrategy: t.frameStrategy,
      primarySubject: t.primarySubject,
    };
  });
}

/**
 * Generates the list of image generation tasks for OpenClaw.
 * These are the first/last frame images that need to be generated on Flow.
 *
 * Returns tasks in generation order (respecting dependencies —
 * continuation shots are skipped for first frame since they inherit).
 */
export function buildFrameGenerationTasks(
  shots: Shot[],
  characterImageMap: Map<string, string>,
  locationImageMap: Map<string, string>,
): FrameGenerationTask[] {
  const chain = resolveFrameChain(shots);
  const tasks: FrameGenerationTask[] = [];

  for (const entry of chain) {
    const shot = shots.find((s) => s.id === entry.shotId);
    if (!shot) continue;

    const metadata = parseMetadata(shot);

    const characters = (metadata?.characters ?? [])
      .map((name) => ({
        name,
        url: characterImageMap.get(name.toLowerCase()) ?? '',
      }))
      .filter((c) => c.url);

    const locationName = metadata?.location ?? '';
    const locationUrl =
      locationImageMap.get(locationName.toLowerCase()) ?? null;

    // First frame: only generate if NOT inherited
    if (entry.firstFrameSource === 'generated' && entry.firstFrameDescription) {
      tasks.push({
        shotId: entry.shotId,
        sequenceNumber: entry.sequenceNumber,
        type: 'first_frame',
        description: entry.firstFrameDescription,
        frameStrategy: entry.frameStrategy,
        primarySubject: entry.primarySubject,
        locationImageUrl: locationUrl,
        characterImageUrls: characters,
      });
    }

    // Last frame: always generate (needed by next shot if it's a continuation)
    if (entry.lastFrameDescription) {
      tasks.push({
        shotId: entry.shotId,
        sequenceNumber: entry.sequenceNumber,
        type: 'last_frame',
        description: entry.lastFrameDescription,
        frameStrategy: entry.frameStrategy,
        primarySubject: entry.primarySubject,
        locationImageUrl: locationUrl,
        characterImageUrls: characters,
      });
    }
  }

  return tasks;
}
