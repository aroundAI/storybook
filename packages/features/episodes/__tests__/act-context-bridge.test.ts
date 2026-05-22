import { describe, expect, it } from 'vitest';

import {
  formatBridgeForPrompt,
  validateAgainstBridge,
} from '../src/lib/canon/act-context-bridge';
import type {
  ActContextBridge,
  CharacterActState,
  ToneVector,
} from '../src/types/act-context';

// =============================================================================
// TEST DATA
// =============================================================================

function makeCharacterState(
  overrides: Partial<CharacterActState> = {},
): CharacterActState {
  return {
    characterId: 'char-1',
    characterName: 'John',
    isAlive: true,
    location: 'the apartment',
    emotionalState: 'anxious',
    emotionalIntensity: 7,
    knowsFacts: ['the secret code'],
    doesNotKnow: ['the betrayal'],
    relationshipChanges: [],
    injuries: [],
    appearance: 'disheveled',
    hasProps: ['briefcase'],
    ...overrides,
  };
}

function makeToneVector(overrides: Partial<ToneVector> = {}): ToneVector {
  return {
    humor: 0.1,
    darkness: 0.6,
    romance: 0.0,
    action: 0.3,
    suspense: 0.8,
    ...overrides,
  };
}

function makeBridge(
  overrides: Partial<ActContextBridge> = {},
): ActContextBridge {
  return {
    movieId: 'movie-1',
    actNumber: 1,
    actTitle: 'Setup',
    actStartTime: 0,
    actEndTime: 1800,
    charactersAlive: ['char-1'],
    characterStates: {
      'char-1': makeCharacterState(),
    },
    openThreads: ['thread-1'],
    resolvedThreads: [],
    promises: [
      {
        id: 'thread-1',
        description: 'The mysterious package',
        madeInAct: 1,
        expectedPayoffAct: 3,
        priority: 'major',
      },
    ],
    currentLocation: {
      locationId: 'loc-1',
      locationName: 'Downtown Apartment',
      isDestroyed: false,
      presentCharacters: ['char-1'],
      establishedDetails: ['Rain on windows', 'Dim lighting'],
    },
    establishedProps: ['briefcase', 'phone'],
    timeOfDay: 'night',
    weatherCondition: 'rainy',
    toneVector: makeToneVector(),
    stakesLevel: 6,
    tensionLevel: 7,
    mustResolve: [],
    mustNotInclude: [],
    setupsToPayoff: ['thread-1'],
    carryForwardContext:
      'John discovered the briefcase contents and is now uncertain who to trust.',
    ...overrides,
  };
}

// =============================================================================
// formatBridgeForPrompt
// =============================================================================

describe('formatBridgeForPrompt', () => {
  it('should include alive characters section', () => {
    const bridge = makeBridge();
    const result = formatBridgeForPrompt(bridge);

    expect(result).toContain('CHARACTERS AT END OF ACT 1');
    expect(result).toContain('John: anxious (at the apartment)');
  });

  it('should include dead characters section when present', () => {
    const bridge = makeBridge({
      characterStates: {
        'char-1': makeCharacterState(),
        'char-2': makeCharacterState({
          characterId: 'char-2',
          characterName: 'Maria',
          isAlive: false,
          emotionalState: 'n/a',
        }),
      },
    });
    const result = formatBridgeForPrompt(bridge);

    expect(result).toContain('DEAD CHARACTERS (DO NOT INCLUDE)');
    expect(result).toContain('Maria - DECEASED');
  });

  it('should not include dead characters section when all alive', () => {
    const bridge = makeBridge();
    const result = formatBridgeForPrompt(bridge);

    expect(result).not.toContain('DEAD CHARACTERS');
  });

  it('should include unresolved plot threads', () => {
    const bridge = makeBridge();
    const result = formatBridgeForPrompt(bridge);

    expect(result).toContain('UNRESOLVED PLOT THREADS');
    expect(result).toContain('The mysterious package (priority: major)');
  });

  it('should include current scene state', () => {
    const bridge = makeBridge();
    const result = formatBridgeForPrompt(bridge);

    expect(result).toContain('CURRENT SCENE STATE');
    expect(result).toContain('Location: Downtown Apartment');
    expect(result).toContain('Time: night');
    expect(result).toContain('Details: Rain on windows, Dim lighting');
  });

  it('should include tone continuation', () => {
    const bridge = makeBridge();
    const result = formatBridgeForPrompt(bridge);

    expect(result).toContain('TONE CONTINUATION');
    expect(result).toContain('Stakes: 6/10, Tension: 7/10');
  });

  it('should include carry forward context', () => {
    const bridge = makeBridge();
    const result = formatBridgeForPrompt(bridge);

    expect(result).toContain('CARRY FORWARD');
    expect(result).toContain(
      'John discovered the briefcase contents and is now uncertain who to trust.',
    );
  });

  it('should include injuries when present', () => {
    const bridge = makeBridge({
      characterStates: {
        'char-1': makeCharacterState({
          injuries: ['broken arm', 'bruised ribs'],
        }),
      },
    });
    const result = formatBridgeForPrompt(bridge);

    expect(result).toContain('Injuries: broken arm, bruised ribs');
  });

  it('should handle empty established details', () => {
    const bridge = makeBridge({
      currentLocation: {
        locationId: 'loc-1',
        locationName: 'Empty Room',
        isDestroyed: false,
        presentCharacters: [],
        establishedDetails: [],
      },
    });
    const result = formatBridgeForPrompt(bridge);

    expect(result).toContain('Location: Empty Room');
    expect(result).not.toContain('Details:');
  });
});

// =============================================================================
// validateAgainstBridge
// =============================================================================

describe('validateAgainstBridge', () => {
  it('should detect dead character resurrection', () => {
    const bridge = makeBridge({
      characterStates: {
        'char-1': makeCharacterState({
          characterName: 'Maria',
          isAlive: false,
        }),
      },
    });

    const result = validateAgainstBridge(
      'Maria walked into the room and looked at the painting.',
      bridge,
    );

    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain('maria');
  });

  it('should pass when dead characters are not acting', () => {
    const bridge = makeBridge({
      characterStates: {
        'char-1': makeCharacterState({
          characterName: 'Maria',
          isAlive: false,
        }),
      },
    });

    const result = validateAgainstBridge(
      'The team mourned the loss of Maria as they pressed forward.',
      bridge,
    );

    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('should return valid when no dead characters exist', () => {
    const bridge = makeBridge();
    const result = validateAgainstBridge(
      'John walked through the rain toward the car.',
      bridge,
    );

    expect(result.valid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('should detect multiple dead character violations', () => {
    const bridge = makeBridge({
      characterStates: {
        'char-1': makeCharacterState({
          characterName: 'Maria',
          isAlive: false,
        }),
        'char-2': makeCharacterState({
          characterId: 'char-2',
          characterName: 'Carlos',
          isAlive: false,
        }),
      },
    });

    const result = validateAgainstBridge(
      'Maria said hello to Carlos who smiled back.',
      bridge,
    );

    expect(result.valid).toBe(false);
    expect(result.violations).toHaveLength(2);
  });

  it('should handle case insensitive character names', () => {
    const bridge = makeBridge({
      characterStates: {
        'char-1': makeCharacterState({
          characterName: 'MARIA',
          isAlive: false,
        }),
      },
    });

    const result = validateAgainstBridge(
      'maria walked through the hall.',
      bridge,
    );

    expect(result.valid).toBe(false);
  });

  it('should handle characters with special regex characters in name', () => {
    const bridge = makeBridge({
      characterStates: {
        'char-1': makeCharacterState({
          characterName: 'Dr. Smith (Jr.)',
          isAlive: false,
        }),
      },
    });

    // Should not throw
    const result = validateAgainstBridge('Something else happened.', bridge);
    expect(result.valid).toBe(true);
  });
});
