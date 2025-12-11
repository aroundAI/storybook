/**
 * DialogueList types and data structure tests (FILM-506)
 *
 * Note: Full component integration tests are complex due to UI component
 * mocking requirements. These tests focus on type validation and data
 * structures used by DialogueList. Full E2E testing via Playwright is
 * recommended for complete component testing.
 */
import { describe, expect, it } from 'vitest';

import type {
  CharacterAsset,
  DialogueLine,
  DialogueLineSummary,
} from '../src/lib/types/dialogue.types';

// Test data fixtures
const mockCharacters: CharacterAsset[] = [
  { id: 'char-1', name: 'Alice', type: 'character' },
  { id: 'char-2', name: 'Bob', type: 'character' },
];

const mockDialogueLines: DialogueLine[] = [
  {
    id: 'line-1',
    episodeId: 'episode-1',
    characterAssetId: 'char-1',
    text: 'Hello, how are you?',
    sequenceNumber: 1,
    status: 'completed',
    audioUrl: 'https://example.com/audio1.mp3',
    generationMetadata: { durationSeconds: 2.5 },
  },
  {
    id: 'line-2',
    episodeId: 'episode-1',
    characterAssetId: 'char-2',
    text: 'I am doing well, thanks!',
    sequenceNumber: 2,
    status: 'pending',
    audioUrl: null,
    generationMetadata: null,
  },
  {
    id: 'line-3',
    episodeId: 'episode-1',
    characterAssetId: 'char-1',
    text: 'Great to hear.',
    sequenceNumber: 3,
    status: 'failed',
    audioUrl: null,
    generationMetadata: { error: 'API rate limit exceeded' },
  },
  {
    id: 'line-4',
    episodeId: 'episode-1',
    characterAssetId: null,
    text: 'The narrator speaks.',
    sequenceNumber: 4,
    status: 'generating',
    audioUrl: null,
    generationMetadata: null,
  },
];

/**
 * Calculate summary counts from dialogue lines
 */
function calculateSummary(lines: DialogueLine[]): DialogueLineSummary {
  return {
    total: lines.length,
    pending: lines.filter((l) => l.status === 'pending').length,
    generating: lines.filter((l) => l.status === 'generating').length,
    completed: lines.filter((l) => l.status === 'completed').length,
    failed: lines.filter((l) => l.status === 'failed').length,
  };
}

/**
 * Get character name from ID
 */
function getCharacterName(
  characterId: string | null,
  characters: CharacterAsset[],
): string {
  if (!characterId) return 'Narrator';
  const character = characters.find((c) => c.id === characterId);
  return character?.name ?? 'Unknown';
}

describe('DialogueList Types and Utilities', () => {
  describe('DialogueLine type', () => {
    it('should have required properties', () => {
      const line = mockDialogueLines[0];
      expect(line).toHaveProperty('id');
      expect(line).toHaveProperty('episodeId');
      expect(line).toHaveProperty('characterAssetId');
      expect(line).toHaveProperty('text');
      expect(line).toHaveProperty('sequenceNumber');
      expect(line).toHaveProperty('status');
      expect(line).toHaveProperty('audioUrl');
      expect(line).toHaveProperty('generationMetadata');
    });

    it('should allow null characterAssetId for narrator lines', () => {
      const narratorLine = mockDialogueLines.find((l) => l.characterAssetId === null);
      expect(narratorLine).toBeDefined();
      expect(narratorLine?.characterAssetId).toBeNull();
    });

    it('should have valid status values', () => {
      const validStatuses = ['pending', 'generating', 'completed', 'failed'];
      mockDialogueLines.forEach((line) => {
        expect(validStatuses).toContain(line.status);
      });
    });
  });

  describe('CharacterAsset type', () => {
    it('should have required properties', () => {
      const character = mockCharacters[0];
      expect(character).toHaveProperty('id');
      expect(character).toHaveProperty('name');
      expect(character).toHaveProperty('type');
      expect(character.type).toBe('character');
    });
  });

  describe('calculateSummary', () => {
    it('should calculate correct totals', () => {
      const summary = calculateSummary(mockDialogueLines);
      expect(summary.total).toBe(4);
      expect(summary.pending).toBe(1);
      expect(summary.generating).toBe(1);
      expect(summary.completed).toBe(1);
      expect(summary.failed).toBe(1);
    });

    it('should handle empty array', () => {
      const summary = calculateSummary([]);
      expect(summary.total).toBe(0);
      expect(summary.pending).toBe(0);
      expect(summary.generating).toBe(0);
      expect(summary.completed).toBe(0);
      expect(summary.failed).toBe(0);
    });

    it('should handle all completed lines', () => {
      const completedLines: DialogueLine[] = mockDialogueLines.map((l) => ({
        ...l,
        status: 'completed' as const,
        audioUrl: 'https://example.com/audio.mp3',
      }));
      const summary = calculateSummary(completedLines);
      expect(summary.completed).toBe(4);
      expect(summary.pending).toBe(0);
      expect(summary.failed).toBe(0);
    });
  });

  describe('getCharacterName', () => {
    it('should return character name for valid ID', () => {
      expect(getCharacterName('char-1', mockCharacters)).toBe('Alice');
      expect(getCharacterName('char-2', mockCharacters)).toBe('Bob');
    });

    it('should return Narrator for null ID', () => {
      expect(getCharacterName(null, mockCharacters)).toBe('Narrator');
    });

    it('should return Unknown for invalid ID', () => {
      expect(getCharacterName('invalid-id', mockCharacters)).toBe('Unknown');
    });
  });

  describe('filtering logic', () => {
    it('should filter by character', () => {
      const char1Lines = mockDialogueLines.filter(
        (l) => l.characterAssetId === 'char-1',
      );
      expect(char1Lines.length).toBe(2);
      expect(char1Lines.every((l) => l.characterAssetId === 'char-1')).toBe(true);
    });

    it('should filter narrator lines (null characterAssetId)', () => {
      const narratorLines = mockDialogueLines.filter(
        (l) => l.characterAssetId === null,
      );
      expect(narratorLines.length).toBe(1);
      expect(narratorLines[0]?.text).toBe('The narrator speaks.');
    });

    it('should filter by status', () => {
      const pendingLines = mockDialogueLines.filter((l) => l.status === 'pending');
      expect(pendingLines.length).toBe(1);
      expect(pendingLines[0]?.id).toBe('line-2');
    });

    it('should filter by search text', () => {
      const searchText = 'hello';
      const filtered = mockDialogueLines.filter((l) =>
        l.text.toLowerCase().includes(searchText.toLowerCase()),
      );
      expect(filtered.length).toBe(1);
      expect(filtered[0]?.id).toBe('line-1');
    });
  });

  describe('sorting logic', () => {
    it('should sort by sequence number', () => {
      const sorted = [...mockDialogueLines].sort(
        (a, b) => a.sequenceNumber - b.sequenceNumber,
      );
      expect(sorted.map((l) => l.sequenceNumber)).toEqual([1, 2, 3, 4]);
    });

    it('should sort by status', () => {
      const statusOrder = { pending: 0, generating: 1, failed: 2, completed: 3 };
      const sorted = [...mockDialogueLines].sort(
        (a, b) => statusOrder[a.status] - statusOrder[b.status],
      );
      expect(sorted.map((l) => l.status)).toEqual([
        'pending',
        'generating',
        'failed',
        'completed',
      ]);
    });

    it('should sort by character name', () => {
      const sorted = [...mockDialogueLines].sort((a, b) => {
        const nameA = getCharacterName(a.characterAssetId, mockCharacters);
        const nameB = getCharacterName(b.characterAssetId, mockCharacters);
        return nameA.localeCompare(nameB);
      });
      // Alice, Alice, Bob, Narrator
      expect(
        sorted.map((l) => getCharacterName(l.characterAssetId, mockCharacters)),
      ).toEqual(['Alice', 'Alice', 'Bob', 'Narrator']);
    });
  });

  describe('selection logic', () => {
    it('should select all filtered lines', () => {
      const filteredIds = mockDialogueLines.map((l) => l.id);
      const selectedLines = new Set(filteredIds);
      expect(selectedLines.size).toBe(4);
      expect(selectedLines.has('line-1')).toBe(true);
      expect(selectedLines.has('line-4')).toBe(true);
    });

    it('should detect indeterminate state', () => {
      const selectedLines = new Set(['line-1', 'line-2']);
      const totalFilteredLines = 4;
      const isAllSelected = selectedLines.size === totalFilteredLines;
      const isIndeterminate =
        selectedLines.size > 0 && selectedLines.size < totalFilteredLines;
      expect(isAllSelected).toBe(false);
      expect(isIndeterminate).toBe(true);
    });

    it('should detect all selected state', () => {
      const selectedLines = new Set(['line-1', 'line-2', 'line-3', 'line-4']);
      const totalFilteredLines = 4;
      const isAllSelected = selectedLines.size === totalFilteredLines;
      expect(isAllSelected).toBe(true);
    });
  });
});
