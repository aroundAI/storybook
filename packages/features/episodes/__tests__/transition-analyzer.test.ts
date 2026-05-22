import { describe, expect, it } from 'vitest';

import type { Shot } from '../src/lib/types';
import {
  analyzeAllTransitions,
  analyzeTransition,
  buildFrameGenerationTasks,
  determineFrameStrategy,
  determinePrimarySubject,
  resolveFrameChain,
} from '../src/server/transition-analyzer';

// ============================================================================
// Test Helpers
// ============================================================================

function makeShot(overrides: Partial<Shot> & { id: string }): Shot {
  return {
    episodeId: 'episode-1',
    sceneNumber: 1,
    shotNumber: 1,
    sequenceNumber: 1,
    description: 'A test shot',
    duration: 8,
    durationSeconds: 8,
    status: 'pending',
    cameraAngle: null,
    cameraMovement: null,
    cameraDirection: null,
    prompt: null,
    videoUrl: null,
    thumbnailUrl: null,
    firstFrameUrl: null,
    lastFrameUrl: null,
    metadata: null,
    generationSettings: null,
    generationJobId: null,
    generationStartedAt: null,
    generationCompletedAt: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

// ============================================================================
// determineFrameStrategy Tests
// ============================================================================

describe('determineFrameStrategy', () => {
  it('should return character_focus for close-up with characters', () => {
    expect(determineFrameStrategy('close-up', 1)).toBe('character_focus');
  });

  it('should return character_focus for extreme-close-up', () => {
    expect(determineFrameStrategy('extreme-close-up', 1)).toBe(
      'character_focus',
    );
  });

  it('should return character_focus for reaction shots', () => {
    expect(determineFrameStrategy('reaction', 1)).toBe('character_focus');
  });

  it('should return environment_focus for wide shots', () => {
    expect(determineFrameStrategy('wide', 0)).toBe('environment_focus');
  });

  it('should return environment_focus for establishing shots', () => {
    expect(determineFrameStrategy('establishing', 0)).toBe('environment_focus');
  });

  it('should return two_shot for two-shot with 2+ characters', () => {
    expect(determineFrameStrategy('two-shot', 2)).toBe('two_shot');
  });

  it('should return group for group-shot with 3+ characters', () => {
    expect(determineFrameStrategy('group-shot', 3)).toBe('group');
  });

  it('should return detail_insert for insert shots', () => {
    expect(determineFrameStrategy('insert', 0)).toBe('detail_insert');
  });

  it('should return detail_insert for POV shots', () => {
    expect(determineFrameStrategy('pov', 0)).toBe('detail_insert');
  });

  it('should fallback to character_focus for 1 character with unknown type', () => {
    expect(determineFrameStrategy('unknown', 1)).toBe('character_focus');
  });

  it('should fallback to two_shot for 2 characters with unknown type', () => {
    expect(determineFrameStrategy('unknown', 2)).toBe('two_shot');
  });

  it('should fallback to environment_focus for 0 characters', () => {
    expect(determineFrameStrategy('unknown', 0)).toBe('environment_focus');
  });
});

// ============================================================================
// determinePrimarySubject Tests
// ============================================================================

describe('determinePrimarySubject', () => {
  it('should return character for close-up with characters', () => {
    const shot = makeShot({
      id: 'shot-1',
      metadata: {
        characters: ['Dante'],
        shotType: 'close-up',
      } as Shot['metadata'],
    });
    const result = determinePrimarySubject(shot);
    expect(result).toEqual({ type: 'character', name: 'Dante' });
  });

  it('should return location for wide shots without characters', () => {
    const shot = makeShot({
      id: 'shot-1',
      metadata: {
        shotType: 'wide',
        location: 'The Park',
      } as Shot['metadata'],
    });
    const result = determinePrimarySubject(shot);
    expect(result).toEqual({ type: 'location', name: 'The Park' });
  });

  it('should return object for insert shots', () => {
    const shot = makeShot({
      id: 'shot-1',
      description: 'Close-up of the mysterious letter on the table',
      metadata: {
        shotType: 'insert',
      } as Shot['metadata'],
    });
    const result = determinePrimarySubject(shot);
    expect(result.type).toBe('object');
  });

  it('should default to first character when no specific shot type', () => {
    const shot = makeShot({
      id: 'shot-1',
      metadata: {
        characters: ['Alice', 'Bob'],
      } as Shot['metadata'],
    });
    const result = determinePrimarySubject(shot);
    expect(result).toEqual({ type: 'character', name: 'Alice' });
  });

  it('should default to location when no characters', () => {
    const shot = makeShot({
      id: 'shot-1',
      metadata: {} as Shot['metadata'],
    });
    const result = determinePrimarySubject(shot);
    expect(result).toEqual({ type: 'location', name: 'scene' });
  });
});

// ============================================================================
// analyzeTransition Tests
// ============================================================================

describe('analyzeTransition', () => {
  it('should return cut for different scenes', () => {
    const prev = makeShot({ id: 'shot-1', sceneNumber: 1 });
    const curr = makeShot({ id: 'shot-2', sceneNumber: 2 });
    expect(analyzeTransition(prev, curr)).toBe('cut');
  });

  it('should return cut when switching from wide to close-up', () => {
    const prev = makeShot({
      id: 'shot-1',
      sceneNumber: 1,
      metadata: { shotType: 'wide', characters: ['Dante'] } as Shot['metadata'],
    });
    const curr = makeShot({
      id: 'shot-2',
      sceneNumber: 1,
      metadata: {
        shotType: 'close-up',
        characters: ['Dante'],
      } as Shot['metadata'],
    });
    expect(analyzeTransition(prev, curr)).toBe('cut');
  });

  it('should return cut when switching from close-up to wide', () => {
    const prev = makeShot({
      id: 'shot-1',
      sceneNumber: 1,
      metadata: {
        shotType: 'close-up',
        characters: ['Dante'],
      } as Shot['metadata'],
    });
    const curr = makeShot({
      id: 'shot-2',
      sceneNumber: 1,
      metadata: { shotType: 'wide', characters: ['Dante'] } as Shot['metadata'],
    });
    expect(analyzeTransition(prev, curr)).toBe('cut');
  });

  it('should return continuation for same shot type with same characters', () => {
    const prev = makeShot({
      id: 'shot-1',
      sceneNumber: 1,
      metadata: {
        shotType: 'medium',
        characters: ['Dante'],
      } as Shot['metadata'],
    });
    const curr = makeShot({
      id: 'shot-2',
      sceneNumber: 1,
      metadata: {
        shotType: 'medium',
        characters: ['Dante'],
      } as Shot['metadata'],
    });
    expect(analyzeTransition(prev, curr)).toBe('continuation');
  });

  it('should return cut when switching between different characters', () => {
    const prev = makeShot({
      id: 'shot-1',
      sceneNumber: 1,
      metadata: {
        shotType: 'medium',
        characters: ['Dante'],
      } as Shot['metadata'],
    });
    const curr = makeShot({
      id: 'shot-2',
      sceneNumber: 1,
      metadata: {
        shotType: 'medium',
        characters: ['Alice'],
      } as Shot['metadata'],
    });
    expect(analyzeTransition(prev, curr)).toBe('cut');
  });

  it('should return continuation for tracking shots with same characters', () => {
    const prev = makeShot({
      id: 'shot-1',
      sceneNumber: 1,
      metadata: {
        characters: ['Dante'],
        veoPrompt: { shotLine: 'SHOT: Medium, tracking from side' },
      } as Shot['metadata'],
    });
    const curr = makeShot({
      id: 'shot-2',
      sceneNumber: 1,
      metadata: {
        characters: ['Dante'],
        veoPrompt: { shotLine: 'SHOT: Medium, tracking forward' },
      } as Shot['metadata'],
    });
    expect(analyzeTransition(prev, curr)).toBe('continuation');
  });

  it('should default to cut when no metadata', () => {
    const prev = makeShot({ id: 'shot-1', sceneNumber: 1 });
    const curr = makeShot({ id: 'shot-2', sceneNumber: 1 });
    expect(analyzeTransition(prev, curr)).toBe('cut');
  });
});

// ============================================================================
// analyzeAllTransitions Tests
// ============================================================================

describe('analyzeAllTransitions', () => {
  it('should mark first shot as cut', () => {
    const shots = [makeShot({ id: 'shot-1', sequenceNumber: 1 })];
    const result = analyzeAllTransitions(shots);
    expect(result).toHaveLength(1);
    expect(result[0]!.transitionType).toBe('cut');
    expect(result[0]!.inheritLastFrame).toBe(false);
  });

  it('should analyze transitions for multiple shots', () => {
    const shots = [
      makeShot({
        id: 'shot-1',
        sequenceNumber: 1,
        sceneNumber: 1,
        metadata: {
          shotType: 'wide',
          characters: ['Dante'],
        } as Shot['metadata'],
      }),
      makeShot({
        id: 'shot-2',
        sequenceNumber: 2,
        sceneNumber: 1,
        metadata: {
          shotType: 'close-up',
          characters: ['Dante'],
        } as Shot['metadata'],
      }),
      makeShot({
        id: 'shot-3',
        sequenceNumber: 3,
        sceneNumber: 2,
        metadata: {
          shotType: 'wide',
          characters: ['Alice'],
        } as Shot['metadata'],
      }),
    ];

    const result = analyzeAllTransitions(shots);
    expect(result).toHaveLength(3);

    // First shot: always cut
    expect(result[0]!.transitionType).toBe('cut');

    // Wide → close-up = cut
    expect(result[1]!.transitionType).toBe('cut');

    // Scene change = cut
    expect(result[2]!.transitionType).toBe('cut');
  });

  it('should detect continuations in same scene with same characters', () => {
    const shots = [
      makeShot({
        id: 'shot-1',
        sequenceNumber: 1,
        sceneNumber: 1,
        metadata: {
          shotType: 'medium',
          characters: ['Dante'],
        } as Shot['metadata'],
      }),
      makeShot({
        id: 'shot-2',
        sequenceNumber: 2,
        sceneNumber: 1,
        metadata: {
          shotType: 'medium',
          characters: ['Dante'],
        } as Shot['metadata'],
      }),
    ];

    const result = analyzeAllTransitions(shots);
    expect(result[1]!.transitionType).toBe('continuation');
    expect(result[1]!.inheritLastFrame).toBe(true);
    expect(result[1]!.continuationFromShotId).toBe('shot-1');
  });

  it('should sort shots by sequence number', () => {
    const shots = [
      makeShot({ id: 'shot-3', sequenceNumber: 3 }),
      makeShot({ id: 'shot-1', sequenceNumber: 1 }),
      makeShot({ id: 'shot-2', sequenceNumber: 2 }),
    ];

    const result = analyzeAllTransitions(shots);
    expect(result[0]!.shotId).toBe('shot-1');
    expect(result[1]!.shotId).toBe('shot-2');
    expect(result[2]!.shotId).toBe('shot-3');
  });
});

// ============================================================================
// resolveFrameChain Tests
// ============================================================================

describe('resolveFrameChain', () => {
  it('should mark first shot as generated', () => {
    const shots = [makeShot({ id: 'shot-1', sequenceNumber: 1 })];
    const chain = resolveFrameChain(shots);
    expect(chain).toHaveLength(1);
    expect(chain[0]!.firstFrameSource).toBe('generated');
    expect(chain[0]!.inheritFromShotId).toBeNull();
  });

  it('should mark continuation shots as inherited', () => {
    const shots = [
      makeShot({
        id: 'shot-1',
        sequenceNumber: 1,
        sceneNumber: 1,
        lastFrameUrl: 'https://example.com/last-frame.png',
        metadata: {
          shotType: 'medium',
          characters: ['Dante'],
        } as Shot['metadata'],
      }),
      makeShot({
        id: 'shot-2',
        sequenceNumber: 2,
        sceneNumber: 1,
        metadata: {
          shotType: 'medium',
          characters: ['Dante'],
        } as Shot['metadata'],
      }),
    ];

    const chain = resolveFrameChain(shots);
    expect(chain[1]!.firstFrameSource).toBe('inherited');
    expect(chain[1]!.inheritFromShotId).toBe('shot-1');
    expect(chain[1]!.inheritFromLastFrameUrl).toBe(
      'https://example.com/last-frame.png',
    );
  });

  it('should mark cut shots as generated', () => {
    const shots = [
      makeShot({
        id: 'shot-1',
        sequenceNumber: 1,
        sceneNumber: 1,
        metadata: {
          shotType: 'wide',
          characters: ['Dante'],
        } as Shot['metadata'],
      }),
      makeShot({
        id: 'shot-2',
        sequenceNumber: 2,
        sceneNumber: 1,
        metadata: {
          shotType: 'close-up',
          characters: ['Dante'],
        } as Shot['metadata'],
      }),
    ];

    const chain = resolveFrameChain(shots);
    expect(chain[1]!.firstFrameSource).toBe('generated');
    expect(chain[1]!.inheritFromShotId).toBeNull();
  });
});

// ============================================================================
// buildFrameGenerationTasks Tests
// ============================================================================

describe('buildFrameGenerationTasks', () => {
  it('should generate first frame tasks for non-inherited shots', () => {
    const shots = [
      makeShot({
        id: 'shot-1',
        sequenceNumber: 1,
        sceneNumber: 1,
        firstFrameDescription: 'Wide establishing shot of the park entrance',
        lastFrameDescription: 'Park bench in center frame',
        metadata: { characters: [], location: 'Park' } as Shot['metadata'],
      }),
    ];

    const tasks = buildFrameGenerationTasks(
      shots,
      new Map(),
      new Map([['park', 'https://example.com/park.png']]),
    );

    expect(tasks).toHaveLength(2); // 1 first frame + 1 last frame
    expect(tasks[0]!.type).toBe('first_frame');
    expect(tasks[0]!.locationImageUrl).toBe('https://example.com/park.png');
    expect(tasks[1]!.type).toBe('last_frame');
  });

  it('should skip first frame for inherited shots', () => {
    const shots = [
      makeShot({
        id: 'shot-1',
        sequenceNumber: 1,
        sceneNumber: 1,
        firstFrameDescription: 'Establishing shot',
        lastFrameDescription: 'End of establishing',
        metadata: {
          shotType: 'medium',
          characters: ['Dante'],
        } as Shot['metadata'],
      }),
      makeShot({
        id: 'shot-2',
        sequenceNumber: 2,
        sceneNumber: 1,
        firstFrameDescription: 'Continuation',
        lastFrameDescription: 'End of continuation',
        metadata: {
          shotType: 'medium',
          characters: ['Dante'],
        } as Shot['metadata'],
      }),
    ];

    const tasks = buildFrameGenerationTasks(shots, new Map(), new Map());

    // Shot 1: first frame + last frame = 2 tasks
    // Shot 2: inherited (no first frame) + last frame = 1 task
    // Total: 3 tasks
    expect(tasks).toHaveLength(3);
    const firstFrameTasks = tasks.filter((t) => t.type === 'first_frame');
    expect(firstFrameTasks).toHaveLength(1);
    expect(firstFrameTasks[0]!.shotId).toBe('shot-1');
  });

  it('should include character image URLs', () => {
    const shots = [
      makeShot({
        id: 'shot-1',
        sequenceNumber: 1,
        firstFrameDescription: 'Dante standing in doorway',
        metadata: {
          characters: ['Dante'],
          location: 'Office',
        } as Shot['metadata'],
      }),
    ];

    const tasks = buildFrameGenerationTasks(
      shots,
      new Map([['dante', 'https://example.com/dante.png']]),
      new Map(),
    );

    expect(tasks[0]!.characterImageUrls).toEqual([
      { name: 'Dante', url: 'https://example.com/dante.png' },
    ]);
  });

  it('should return empty array when no frame descriptions', () => {
    const shots = [makeShot({ id: 'shot-1', sequenceNumber: 1 })];
    const tasks = buildFrameGenerationTasks(shots, new Map(), new Map());
    expect(tasks).toHaveLength(0);
  });
});
