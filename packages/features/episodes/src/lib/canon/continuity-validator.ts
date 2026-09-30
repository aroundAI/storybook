/**
 * Continuity Validator
 * Phase 10: FILM-1003
 *
 * Validates narrative continuity against canon data.
 * Implements 9 validation rules (CANON_001-009).
 */
import type { ProjectType } from '@kit/film-studio-schemas/project';

import { staleForEpisodes } from './thread-staleness';
import type {
  ContinuityValidationResult,
  ContinuityViolation,
  MemoryContext,
  PlotSkeleton,
  ValidationCheckpoint,
  ViolationCode,
  ViolationSeverity,
} from './types';

// =============================================================================
// RULE DEFINITIONS
// =============================================================================

interface ValidationRule {
  code: ViolationCode;
  name: string;
  severity: ViolationSeverity;
  checkpoints: ValidationCheckpoint[];
}

const VALIDATION_RULES: ValidationRule[] = [
  {
    code: 'CANON_001',
    name: 'Resurrection Failure',
    severity: 'error',
    checkpoints: ['STORY', 'SCREENPLAY'],
  },
  {
    code: 'CANON_002',
    name: 'State Reversal',
    severity: 'error',
    checkpoints: ['STORY', 'SCREENPLAY'],
  },
  {
    code: 'CANON_003',
    name: 'Knowledge Violation',
    severity: 'warning',
    checkpoints: ['STORY', 'SCREENPLAY'],
  },
  {
    code: 'CANON_004',
    name: 'Authorization Missing',
    severity: 'warning',
    checkpoints: ['STORY', 'SCREENPLAY', 'PUBLISH'],
  },
  {
    code: 'CANON_005',
    name: 'World Contradiction',
    severity: 'error',
    checkpoints: ['STORY', 'SCREENPLAY'],
  },
  {
    code: 'CANON_006',
    name: 'Reference Violation',
    severity: 'warning',
    checkpoints: ['STORY', 'SCREENPLAY'],
  },
  {
    code: 'CANON_007',
    name: 'Connectivity Failure',
    severity: 'info',
    checkpoints: ['SCREENPLAY', 'PUBLISH'],
  },
  {
    code: 'CANON_008',
    name: 'Escalation Overflow',
    severity: 'warning',
    checkpoints: ['STORY'],
  },
  {
    code: 'CANON_009',
    name: 'Tone Drift',
    severity: 'info',
    checkpoints: ['STORY', 'SCREENPLAY'],
  },
  {
    code: 'CANON_011',
    name: 'Causality Break',
    severity: 'error',
    checkpoints: ['STORY'],
  },
  {
    code: 'CANON_012',
    name: 'Standalone Episode',
    severity: 'info',
    checkpoints: ['STORY', 'SCREENPLAY'],
  },
];

/**
 * Share of the available callback targets an episode should touch, by
 * content type (FILM-1003 rule 7).
 */
const MIN_CONNECTIVITY_RATIO: Record<ProjectType, number> = {
  series: 0.25,
  'short-film': 0.1,
  movie: 0.1,
  documentary: 0.05,
  educational: 0.05,
  ad: 0,
  news: 0,
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Checks if two event keys conflict.
 * Keys conflict if they refer to same entity in contradictory states.
 */
function _keysConflict(key1: string, key2: string): boolean {
  const parts1 = key1.split(':');
  const parts2 = key2.split(':');

  // Must have same entity type and ID
  if (parts1[0] !== parts2[0] || parts1[1] !== parts2[1]) {
    return false;
  }

  // Check for state conflicts
  const state1 = parts1[2];
  const state2 = parts2[2];

  // Dead vs alive is a conflict
  if (
    (state1 === 'dead' && state2 === 'alive') ||
    (state1 === 'alive' && state2 === 'dead')
  ) {
    return true;
  }

  // Destroyed vs exists is a conflict
  if (
    (state1 === 'destroyed' && state2 === 'exists') ||
    (state1 === 'exists' && state2 === 'destroyed')
  ) {
    return true;
  }

  return false;
}

/**
 * Generates an event key from text content.
 * Format: "{entity}:{id}:{state}"
 */
function _extractEventKey(
  text: string,
  characterNames: string[],
): string | null {
  const lowerText = text.toLowerCase();

  // Check for character mentions with death indicators
  for (const name of characterNames) {
    const lowerName = name.toLowerCase();
    // Escape special regex characters in name to prevent errors
    const escapedName = lowerName.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const nameRegex = new RegExp(`\\b${escapedName}\\b`);

    if (nameRegex.test(lowerText)) {
      // Check for alive/present indicators using word boundaries
      if (/\b(appears|walks|speaks|enters)\b/.test(lowerText)) {
        return `character:${lowerName}:alive`;
      }
    }
  }

  return null;
}

/**
 * Suggests an alternative for a violation.
 */
function suggestAlternative(violationType: string, _content: string): string {
  switch (violationType) {
    case 'resurrection':
      return 'Use flashback, memory, dream sequence, or a different character.';
    case 'state_reversal':
      return 'Show gradual change with proper trigger event, or acknowledge the contradiction in dialogue.';
    case 'knowledge':
      return 'Have another character share the information first, or use dramatic irony.';
    case 'world':
      return 'Establish an exception or update the world rules with explanation.';
    default:
      return 'Review the canon constraints and adjust the content accordingly.';
  }
}

// =============================================================================
// RULE IMPLEMENTATIONS
// =============================================================================

/**
 * CANON_001: Resurrection Failure
 * Checks if dead characters appear alive.
 */
function checkResurrectionFailure(
  skeleton: PlotSkeleton,
  context: MemoryContext,
): ContinuityViolation[] {
  const violations: ContinuityViolation[] = [];

  // Find death events in immutable canon
  const deathEvents = context.immutableEvents.filter(
    (e) => e.eventType === 'death',
  );

  if (deathEvents.length === 0) return violations;

  // Check each scene for dead characters appearing
  for (const scene of skeleton.scenes) {
    for (const charId of scene.charactersPresent) {
      const charName = skeleton.characters.find(
        (c) => c.characterId === charId,
      )?.name;
      if (!charName) continue;

      // Check if this character is dead
      const deathEvent = deathEvents.find((e) =>
        e.eventKey.toLowerCase().includes(charName.toLowerCase()),
      );

      if (deathEvent) {
        violations.push({
          code: 'CANON_001',
          severity: 'error',
          message: `Cannot show ${charName} alive in scene ${scene.sceneNumber}. ${deathEvent.description}`,
          location: {
            sceneNumber: scene.sceneNumber,
            characterId: charId,
          },
          suggestion: suggestAlternative('resurrection', charName),
          relatedEvents: [deathEvent.id],
        });
      }
    }
  }

  return violations;
}

/**
 * CANON_002: State Reversal
 * Checks if character states regress without authorization.
 */
function checkStateReversal(
  skeleton: PlotSkeleton,
  context: MemoryContext,
): ContinuityViolation[] {
  const violations: ContinuityViolation[] = [];

  for (const charContext of context.characterStates) {
    const latestEmotional = charContext.currentStates.find(
      (s) => s.stateType === 'emotional',
    );

    if (!latestEmotional) continue;

    const currentState = (latestEmotional.stateValue as Record<string, unknown>)
      .state as string | undefined;
    const constraints = charContext.constraints;

    // Check if proposed arc contradicts constraints
    const plotChar = skeleton.characters.find(
      (c) => c.characterId === charContext.characterId,
    );

    if (plotChar?.emotionalArc) {
      const proposedArc = plotChar.emotionalArc.toLowerCase();

      for (const constraint of constraints) {
        if (proposedArc.includes(constraint.replace('cannot be ', ''))) {
          violations.push({
            code: 'CANON_002',
            severity: 'error',
            message: `${plotChar.name} cannot revert to "${proposedArc}". Current state: "${currentState}". Constraint: "${constraint}"`,
            location: {
              characterId: charContext.characterId,
            },
            suggestion: suggestAlternative('state_reversal', proposedArc),
          });
        }
      }
    }
  }

  return violations;
}

/**
 * CANON_003: Knowledge Violation
 * Checks if characters know information they shouldn't.
 */
function checkKnowledgeViolation(
  skeleton: PlotSkeleton,
  context: MemoryContext,
): ContinuityViolation[] {
  const violations: ContinuityViolation[] = [];

  // Build knowledge map from character states
  const knowledgeMap = new Map<string, Set<string>>();

  for (const charContext of context.characterStates) {
    const knowledgeStates = charContext.currentStates.filter(
      (s) => s.stateType === 'knowledge',
    );

    const facts = new Set<string>();
    for (const state of knowledgeStates) {
      const fact = (state.stateValue as Record<string, unknown>).fact;
      if (typeof fact === 'string') {
        facts.add(fact.toLowerCase());
      }
    }

    knowledgeMap.set(charContext.characterId, facts);
  }

  // Check scenes for knowledge usage
  for (const scene of skeleton.scenes) {
    const keyEvents = scene.keyEvents ?? [];

    for (const event of keyEvents) {
      const lowerEvent = event.toLowerCase();

      // Check if any character references knowledge they don't have
      for (const charId of scene.charactersPresent) {
        const charKnowledge = knowledgeMap.get(charId) ?? new Set();
        const charName =
          skeleton.characters.find((c) => c.characterId === charId)?.name ?? '';

        // Look for "reveals", "knows", "mentions" patterns
        if (
          lowerEvent.includes('reveals') ||
          lowerEvent.includes('knows') ||
          lowerEvent.includes('mentions')
        ) {
          // This is a heuristic - real implementation would use NLP
          // For now, flag if character has no established knowledge
          if (charKnowledge.size === 0) {
            violations.push({
              code: 'CANON_003',
              severity: 'warning',
              message: `${charName} references knowledge in scene ${scene.sceneNumber} but has no established knowledge base.`,
              location: {
                sceneNumber: scene.sceneNumber,
                characterId: charId,
              },
              suggestion: suggestAlternative('knowledge', event),
            });
          }
        }
      }
    }
  }

  return violations;
}

/**
 * CANON_004: Authorization Missing
 * Checks if state changes have proper trigger/cost/constraint triplet.
 */
function checkAuthorizationMissing(
  skeleton: PlotSkeleton,
  _context: MemoryContext,
): ContinuityViolation[] {
  const violations: ContinuityViolation[] = [];

  // Check each character's proposed arc for authorization
  for (const char of skeleton.characters) {
    if (char.emotionalArc) {
      // Major emotional changes need authorization
      const majorChanges = [
        'transforms',
        'becomes',
        'changes',
        'evolves',
        'shifts',
      ];

      const hassMajorChange = majorChanges.some((change) =>
        char.emotionalArc?.toLowerCase().includes(change),
      );

      if (hassMajorChange) {
        violations.push({
          code: 'CANON_004',
          severity: 'warning',
          message: `${char.name}'s arc "${char.emotionalArc}" requires an authorization triplet (trigger, cost, constraint).`,
          location: {
            characterId: char.characterId,
          },
          suggestion:
            'Add explicit trigger event, what the character sacrifices, and new constraints.',
        });
      }
    }
  }

  return violations;
}

/**
 * CANON_005: World Contradiction
 * Checks if content contradicts established world facts.
 */
function checkWorldContradiction(
  skeleton: PlotSkeleton,
  context: MemoryContext,
): ContinuityViolation[] {
  const violations: ContinuityViolation[] = [];

  // Get world facts from immutable events
  const worldFacts = context.immutableEvents.filter(
    (e) => e.eventType === 'world_fact',
  );

  for (const scene of skeleton.scenes) {
    const summary = scene.summary.toLowerCase();

    for (const fact of worldFacts) {
      // Check for contradictions (simplified heuristic)
      const factKey = fact.eventKey.split(':')[1] ?? '';

      // e.g., if world has "no_magic" and scene mentions "casts spell"
      if (factKey === 'no_magic' && summary.includes('magic')) {
        violations.push({
          code: 'CANON_005',
          severity: 'error',
          message: `Scene ${scene.sceneNumber} contradicts world fact: ${fact.description}`,
          location: { sceneNumber: scene.sceneNumber },
          suggestion: suggestAlternative('world', summary),
          relatedEvents: [fact.id],
        });
      }

      // e.g., using destroyed location
      if (
        factKey.includes('destroyed') &&
        summary.includes(factKey.replace('_destroyed', ''))
      ) {
        violations.push({
          code: 'CANON_005',
          severity: 'error',
          message: `Scene ${scene.sceneNumber} uses location that was destroyed: ${fact.description}`,
          location: { sceneNumber: scene.sceneNumber },
          suggestion: 'Use a different location or show the ruins.',
          relatedEvents: [fact.id],
        });
      }
    }
  }

  return violations;
}

/**
 * CANON_006: Reference Violation
 * Checks for references to non-existent events or characters.
 */
function checkReferenceViolation(
  skeleton: PlotSkeleton,
  context: MemoryContext,
): ContinuityViolation[] {
  const violations: ContinuityViolation[] = [];

  // Get all known character IDs
  const knownCharIds = new Set([
    ...context.characterStates.map((c) => c.characterId),
    ...context.immutableEvents
      .filter((e) => e.metadata?.character_id)
      .map((e) => e.metadata?.character_id as string),
  ]);

  // Check for references to unknown characters
  for (const scene of skeleton.scenes) {
    for (const charId of scene.charactersPresent) {
      if (!knownCharIds.has(charId)) {
        const charName =
          skeleton.characters.find((c) => c.characterId === charId)?.name ??
          charId;

        violations.push({
          code: 'CANON_006',
          severity: 'warning',
          message: `Scene ${scene.sceneNumber} references unknown character: ${charName}`,
          location: {
            sceneNumber: scene.sceneNumber,
            characterId: charId,
          },
          suggestion:
            'Introduce the character first or use an established character.',
        });
      }
    }
  }

  return violations;
}

/**
 * CANON_007: Connectivity Failure
 * Checks if narrative threads are stale (untouched for many episodes).
 * Open threads are NORMAL — only flag threads whose last active episode
 * (`lastActiveEpisodeNumber`, by number) is 5+ episodes before this one, as
 * they may be genuinely forgotten.
 */
function checkConnectivityFailure(
  skeleton: PlotSkeleton,
  context: MemoryContext,
): ContinuityViolation[] {
  const violations: ContinuityViolation[] = [];
  const currentEpisode = skeleton.episodeNumber ?? context.episodeNumber;
  const staleThreshold = 5;

  for (const thread of context.activeThreads) {
    const promises = thread.promises ?? [];
    if (promises.length === 0) continue;

    const payoffs = thread.payoffs ?? [];

    // The canon health dashboard's rule too (KB-72, KB-108): unknown is not
    // stale.
    const episodesSinceTouch = staleForEpisodes(
      thread.lastActiveEpisodeNumber,
      currentEpisode,
      staleThreshold,
    );

    // Only flag if thread is stale AND has no payoffs
    if (payoffs.length === 0 && episodesSinceTouch !== undefined) {
      violations.push({
        code: 'CANON_007',
        severity: 'info',
        message: `Thread "${thread.threadName}" has ${promises.length} unfulfilled promise(s), untouched for ${episodesSinceTouch} episodes.`,
        suggestion: `Consider progressing or resolving: ${promises.slice(0, 2).join(', ')}`,
      });
    }
  }

  return violations;
}

/**
 * CANON_008: Escalation Overflow
 * Checks if stakes escalate beyond sustainable levels.
 */
function checkEscalationOverflow(
  skeleton: PlotSkeleton,
  context: MemoryContext,
): ContinuityViolation[] {
  const violations: ContinuityViolation[] = [];

  // Count high-stakes events in recent summaries
  const highStakesKeywords = [
    'death',
    'betrayal',
    'war',
    'catastrophe',
    'apocalypse',
    'destruction',
    'massacre',
  ];

  let recentHighStakesCount = 0;
  for (const summary of context.recentSummaries) {
    const lowerSummary = summary.plotSummary.toLowerCase();
    for (const keyword of highStakesKeywords) {
      if (lowerSummary.includes(keyword)) {
        recentHighStakesCount++;
        break;
      }
    }
  }

  // Check current episode for high stakes
  let currentHighStakes = 0;
  for (const scene of skeleton.scenes) {
    const lowerSummary = scene.summary.toLowerCase();
    for (const keyword of highStakesKeywords) {
      if (lowerSummary.includes(keyword)) {
        currentHighStakes++;
        break;
      }
    }
  }

  // If too many high-stakes events (more than 50% of scenes)
  const highStakeRatio = currentHighStakes / skeleton.scenes.length;
  if (highStakeRatio > 0.5 && recentHighStakesCount > 3) {
    violations.push({
      code: 'CANON_008',
      severity: 'warning',
      message: `Escalation overflow: ${Math.round(highStakeRatio * 100)}% of scenes have high stakes, and ${recentHighStakesCount} recent episodes also had high stakes.`,
      suggestion:
        'Add breathing room with lower-stakes scenes for better pacing.',
    });
  }

  return violations;
}

/**
 * CANON_009: Tone Drift
 * Checks for genre/tone inconsistency.
 */
function checkToneDrift(
  skeleton: PlotSkeleton,
  context: MemoryContext,
): ContinuityViolation[] {
  const violations: ContinuityViolation[] = [];

  // Calculate average sentiment from recent episodes
  const sentiments = context.recentSummaries
    .filter((s) => s.sentimentScore !== undefined)
    .map((s) => s.sentimentScore!);

  if (sentiments.length < 3) return violations; // Not enough data

  const avgSentiment =
    sentiments.reduce((a, b) => a + b, 0) / sentiments.length;

  // Analyze current episode tone (simplified)
  const darkKeywords = ['death', 'tragedy', 'grief', 'betrayal', 'violence'];
  const lightKeywords = ['hope', 'joy', 'celebration', 'victory', 'love'];

  let darkScore = 0;
  let lightScore = 0;

  for (const scene of skeleton.scenes) {
    const lowerSummary = scene.summary.toLowerCase();
    for (const keyword of darkKeywords) {
      if (lowerSummary.includes(keyword)) darkScore++;
    }
    for (const keyword of lightKeywords) {
      if (lowerSummary.includes(keyword)) lightScore++;
    }
  }

  const currentSentiment = lightScore / (darkScore + lightScore + 1);

  // Check for significant drift (more than 0.3 difference)
  if (Math.abs(currentSentiment - avgSentiment) > 0.3) {
    violations.push({
      code: 'CANON_009',
      severity: 'info',
      message: `Tone drift detected. Recent average: ${(avgSentiment * 100).toFixed(0)}% positive. Current episode: ${(currentSentiment * 100).toFixed(0)}% positive.`,
      suggestion:
        'Ensure tonal shift is intentional and properly set up in the narrative.',
    });
  }

  return violations;
}

/**
 * CANON_011: Causality Break
 * A scene cannot build on the outcome of a scene that has not happened yet.
 */
function checkCausalityBreak(skeleton: PlotSkeleton): ContinuityViolation[] {
  const violations: ContinuityViolation[] = [];
  const sceneNumbers = new Set(skeleton.scenes.map((s) => s.sceneNumber));

  for (const scene of skeleton.scenes) {
    for (const causeNumber of scene.dependsOnScenes ?? []) {
      if (causeNumber >= scene.sceneNumber && sceneNumbers.has(causeNumber)) {
        violations.push({
          code: 'CANON_011',
          severity: 'error',
          message: `Scene ${scene.sceneNumber} builds on the outcome of scene ${causeNumber}, which does not happen before it.`,
          location: { sceneNumber: scene.sceneNumber },
          suggestion:
            'Move the cause before its effect, or drop the dependency.',
        });
      }
    }
  }

  return violations;
}

/**
 * CANON_012: Standalone Episode
 * Flags an episode that touches too little of the established canon
 * (characters, open threads, locations, immutable events) for its content
 * type. Skipped while there is no canon to call back to.
 */
function checkStandaloneEpisode(
  skeleton: PlotSkeleton,
  context: MemoryContext,
): ContinuityViolation[] {
  const targets =
    context.characterStates.length +
    context.activeThreads.length +
    (context.worldState ? 1 : 0) +
    context.immutableEvents.length;
  if (targets === 0) return [];

  const text = skeleton.scenes
    .map((s) => [s.summary, s.location ?? '', ...(s.keyEvents ?? [])].join(' '))
    .join(' ')
    .toLowerCase();
  const mentions = (name: string) =>
    name.length > 0 && text.includes(name.toLowerCase());
  const plotCharacterIds = new Set(
    skeleton.characters.map((c) => c.characterId),
  );

  const callbacks =
    context.characterStates.filter(
      (c) => plotCharacterIds.has(c.characterId) || mentions(c.characterName),
    ).length +
    context.activeThreads.filter((t) => mentions(t.threadName)).length +
    (context.worldState && mentions(context.worldState.location) ? 1 : 0) +
    context.immutableEvents.filter((e) => mentions(e.eventKey)).length;

  const minRatio =
    MIN_CONNECTIVITY_RATIO[context.metadata?.projectType ?? 'series'];
  const ratio = callbacks / targets;
  if (ratio >= minRatio) return [];

  return [
    {
      code: 'CANON_012',
      severity: 'info',
      message: `Episode connectivity ${(ratio * 100).toFixed(0)}% is below the ${(minRatio * 100).toFixed(0)}% threshold: ${callbacks} callback(s) to ${targets} established canon item(s).`,
      suggestion:
        'Reference an established character, open thread, location or event.',
    },
  ];
}

// =============================================================================
// MAIN VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validates a plot skeleton against memory context.
 * Used at STORY checkpoint.
 */
export function validatePlotSkeleton(
  skeleton: PlotSkeleton,
  context: MemoryContext,
): ContinuityValidationResult {
  const violations: ContinuityViolation[] = [];

  // Run all applicable rules
  violations.push(...checkResurrectionFailure(skeleton, context));
  violations.push(...checkStateReversal(skeleton, context));
  violations.push(...checkKnowledgeViolation(skeleton, context));
  violations.push(...checkAuthorizationMissing(skeleton, context));
  violations.push(...checkWorldContradiction(skeleton, context));
  violations.push(...checkReferenceViolation(skeleton, context));
  violations.push(...checkConnectivityFailure(skeleton, context));
  violations.push(...checkEscalationOverflow(skeleton, context));
  violations.push(...checkToneDrift(skeleton, context));
  violations.push(...checkCausalityBreak(skeleton));
  violations.push(...checkStandaloneEpisode(skeleton, context));

  // Determine passed rules
  const violatedCodes = new Set(violations.map((v) => v.code));
  const passedRules = VALIDATION_RULES.filter(
    (r) => !violatedCodes.has(r.code),
  ).map((r) => r.code);

  // Count by severity
  const summary = {
    errors: violations.filter((v) => v.severity === 'error').length,
    warnings: violations.filter((v) => v.severity === 'warning').length,
    infos: violations.filter((v) => v.severity === 'info').length,
  };

  return {
    valid: summary.errors === 0,
    violations,
    passedRules,
    summary,
    validatedAt: new Date().toISOString(),
  };
}

/**
 * Validates scene blocks (array of scene summaries).
 * Used at SCREENPLAY checkpoint.
 */
export function validateSceneBlocks(
  scenes: Array<{ sceneNumber: number; content: string }>,
  context: MemoryContext,
): ContinuityValidationResult {
  // Convert to PlotSkeleton format for reuse
  const skeleton: PlotSkeleton = {
    premise: '',
    episodeNumber: context.episodeNumber,
    scenes: scenes.map((s) => ({
      sceneNumber: s.sceneNumber,
      summary: s.content,
      charactersPresent: [],
    })),
    characters: [],
  };

  // Run subset of rules applicable to screenplay
  const violations: ContinuityViolation[] = [];
  violations.push(...checkResurrectionFailure(skeleton, context));
  violations.push(...checkWorldContradiction(skeleton, context));
  violations.push(...checkToneDrift(skeleton, context));
  violations.push(...checkStandaloneEpisode(skeleton, context));

  const violatedCodes = new Set(violations.map((v) => v.code));
  const passedRules = VALIDATION_RULES.filter(
    (r) => !violatedCodes.has(r.code) && r.checkpoints.includes('SCREENPLAY'),
  ).map((r) => r.code);

  const summary = {
    errors: violations.filter((v) => v.severity === 'error').length,
    warnings: violations.filter((v) => v.severity === 'warning').length,
    infos: violations.filter((v) => v.severity === 'info').length,
  };

  return {
    valid: summary.errors === 0,
    violations,
    passedRules,
    summary,
    validatedAt: new Date().toISOString(),
  };
}

/**
 * Gets rules applicable to a specific checkpoint.
 */
export function getRulesForCheckpoint(
  checkpoint: ValidationCheckpoint,
): ValidationRule[] {
  return VALIDATION_RULES.filter((r) => r.checkpoints.includes(checkpoint));
}
