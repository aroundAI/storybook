import { describe, expect, it } from 'vitest';

import {
  SNAP_POINTS,
  SNAP_THRESHOLD_PX,
  dragStyles,
  dropZoneStyles,
  emptyStates,
  errorMessages,
  getDropZoneStyle,
  getNextGridIndex,
  initialDragState,
  isAssetAccepted,
  isMetaKeyShortcut,
  isWithinSnapThreshold,
  realtimeChannels,
  shotGridKeyboardShortcuts,
  skeletonPatterns,
  snapToGrid,
  timelineKeyboardShortcuts,
} from '../src/lib/interaction-patterns';

describe('Interaction Patterns', () => {
  describe('Drag State', () => {
    it('should have correct initial drag state', () => {
      expect(initialDragState.isDragging).toBe(false);
      expect(initialDragState.draggedId).toBeNull();
      expect(initialDragState.dropTargetId).toBeNull();
    });
  });

  describe('Drag Styles', () => {
    it('should have all required drag style states', () => {
      expect(dragStyles).toHaveProperty('dragging');
      expect(dragStyles).toHaveProperty('dropTarget');
      expect(dragStyles).toHaveProperty('invalid');
    });

    it('should include z-index for dragging state', () => {
      expect(dragStyles.dragging).toContain('z-50');
    });

    it('should include ring classes for drop targets', () => {
      expect(dragStyles.dropTarget).toContain('ring-2');
      expect(dragStyles.dropTarget).toContain('ring-primary');
    });

    it('should include destructive ring for invalid targets', () => {
      expect(dragStyles.invalid).toContain('ring-destructive');
    });
  });

  describe('Drop Zone Styles', () => {
    it('should have all required drop zone states', () => {
      expect(dropZoneStyles).toHaveProperty('idle');
      expect(dropZoneStyles).toHaveProperty('active');
      expect(dropZoneStyles).toHaveProperty('invalid');
      expect(dropZoneStyles).toHaveProperty('hasContent');
    });

    it('should use dashed border for idle state', () => {
      expect(dropZoneStyles.idle).toContain('border-dashed');
    });

    it('should use solid border for hasContent state', () => {
      expect(dropZoneStyles.hasContent).toContain('border-solid');
    });
  });

  describe('Snap Configuration', () => {
    it('should have reasonable snap threshold', () => {
      expect(SNAP_THRESHOLD_PX).toBeGreaterThan(0);
      expect(SNAP_THRESHOLD_PX).toBeLessThan(50);
    });

    it('should have all snap point types', () => {
      expect(SNAP_POINTS).toContain('clipEdges');
      expect(SNAP_POINTS).toContain('playhead');
      expect(SNAP_POINTS).toContain('gridLines');
    });
  });

  describe('Keyboard Shortcuts', () => {
    describe('Shot Grid Shortcuts', () => {
      it('should have arrow key navigation', () => {
        expect(shotGridKeyboardShortcuts).toHaveProperty('ArrowLeft');
        expect(shotGridKeyboardShortcuts).toHaveProperty('ArrowRight');
        expect(shotGridKeyboardShortcuts).toHaveProperty('ArrowUp');
        expect(shotGridKeyboardShortcuts).toHaveProperty('ArrowDown');
      });

      it('should have action keys', () => {
        expect(shotGridKeyboardShortcuts).toHaveProperty('Space');
        expect(shotGridKeyboardShortcuts).toHaveProperty('Enter');
        expect(shotGridKeyboardShortcuts).toHaveProperty('Delete');
        expect(shotGridKeyboardShortcuts).toHaveProperty('Escape');
      });

      it('should have select all shortcut', () => {
        expect(shotGridKeyboardShortcuts).toHaveProperty('Cmd/Ctrl+A');
      });
    });

    describe('Timeline Shortcuts', () => {
      it('should have playback controls', () => {
        expect(timelineKeyboardShortcuts).toHaveProperty('Space');
        expect(timelineKeyboardShortcuts).toHaveProperty('Home');
        expect(timelineKeyboardShortcuts).toHaveProperty('End');
      });

      it('should have scrubbing controls', () => {
        expect(timelineKeyboardShortcuts).toHaveProperty('ArrowLeft');
        expect(timelineKeyboardShortcuts).toHaveProperty('ArrowRight');
        expect(timelineKeyboardShortcuts).toHaveProperty('Shift+ArrowLeft');
        expect(timelineKeyboardShortcuts).toHaveProperty('Shift+ArrowRight');
      });

      it('should have in/out point controls', () => {
        expect(timelineKeyboardShortcuts).toHaveProperty('[');
        expect(timelineKeyboardShortcuts).toHaveProperty(']');
      });

      it('should have zoom controls', () => {
        expect(timelineKeyboardShortcuts).toHaveProperty('+');
        expect(timelineKeyboardShortcuts).toHaveProperty('-');
      });

      it('should have undo/redo controls', () => {
        expect(timelineKeyboardShortcuts).toHaveProperty('Cmd/Ctrl+Z');
        expect(timelineKeyboardShortcuts).toHaveProperty('Cmd/Ctrl+Shift+Z');
      });
    });
  });

  describe('Empty States', () => {
    it('should have all required empty state configs', () => {
      expect(emptyStates).toHaveProperty('episodes');
      expect(emptyStates).toHaveProperty('characters');
      expect(emptyStates).toHaveProperty('shots');
      expect(emptyStates).toHaveProperty('dialogue');
      expect(emptyStates).toHaveProperty('assets');
    });

    it('should have title and description for each state', () => {
      Object.values(emptyStates).forEach((state) => {
        expect(state).toHaveProperty('title');
        expect(state).toHaveProperty('description');
        expect(state).toHaveProperty('actionLabel');
      });
    });
  });

  describe('Skeleton Patterns', () => {
    it('should have all required skeleton patterns', () => {
      expect(skeletonPatterns).toHaveProperty('video');
      expect(skeletonPatterns).toHaveProperty('thumbnail');
      expect(skeletonPatterns).toHaveProperty('title');
      expect(skeletonPatterns).toHaveProperty('subtitle');
      expect(skeletonPatterns).toHaveProperty('badge');
      expect(skeletonPatterns).toHaveProperty('avatar');
      expect(skeletonPatterns).toHaveProperty('button');
    });

    it('should use aspect ratio for video skeleton', () => {
      expect(skeletonPatterns.video).toBe('aspect-video');
    });

    it('should use square aspect for thumbnail', () => {
      expect(skeletonPatterns.thumbnail).toBe('aspect-square');
    });
  });

  describe('Error Messages', () => {
    it('should have all required error types', () => {
      expect(errorMessages).toHaveProperty('generationFailed');
      expect(errorMessages).toHaveProperty('providerUnavailable');
      expect(errorMessages).toHaveProperty('creditLimitReached');
      expect(errorMessages).toHaveProperty('networkError');
      expect(errorMessages).toHaveProperty('contentModeration');
    });

    it('should have title for each error type', () => {
      Object.values(errorMessages).forEach((error) => {
        expect(error).toHaveProperty('title');
      });
    });

    it('should mark retryable errors correctly', () => {
      expect(errorMessages.generationFailed.retryable).toBe(true);
      expect(errorMessages.networkError.retryable).toBe(true);
      expect(errorMessages.providerUnavailable.retryable).toBe(false);
      expect(errorMessages.creditLimitReached.retryable).toBe(false);
    });

    it('should have action for credit limit error', () => {
      expect(errorMessages.creditLimitReached).toHaveProperty('actionLabel');
      expect(errorMessages.creditLimitReached).toHaveProperty('actionHref');
    });
  });

  describe('Realtime Channels', () => {
    it('should have channel config for shots', () => {
      expect(realtimeChannels.shots.table).toBe('shots');
      expect(realtimeChannels.shots.filterColumn).toBe('episode_id');
    });

    it('should have channel config for jobs', () => {
      expect(realtimeChannels.jobs.table).toBe('generation_jobs');
      expect(realtimeChannels.jobs.filterColumn).toBe('account_id');
    });

    it('should have channel config for episodes', () => {
      expect(realtimeChannels.episodes.table).toBe('episodes');
      expect(realtimeChannels.episodes.filterColumn).toBe('project_id');
    });
  });
});

describe('Utility Functions', () => {
  describe('getNextGridIndex', () => {
    // Grid layout (4 columns, 8 items):
    // 0 1 2 3
    // 4 5 6 7

    it('should navigate to next item', () => {
      expect(getNextGridIndex(0, 'next', 8, 4)).toBe(1);
      expect(getNextGridIndex(3, 'next', 8, 4)).toBe(4);
      expect(getNextGridIndex(6, 'next', 8, 4)).toBe(7);
    });

    it('should return null when at end for next', () => {
      expect(getNextGridIndex(7, 'next', 8, 4)).toBeNull();
    });

    it('should navigate to previous item', () => {
      expect(getNextGridIndex(1, 'prev', 8, 4)).toBe(0);
      expect(getNextGridIndex(4, 'prev', 8, 4)).toBe(3);
      expect(getNextGridIndex(7, 'prev', 8, 4)).toBe(6);
    });

    it('should return null when at start for prev', () => {
      expect(getNextGridIndex(0, 'prev', 8, 4)).toBeNull();
    });

    it('should navigate down by column count', () => {
      expect(getNextGridIndex(0, 'down', 8, 4)).toBe(4);
      expect(getNextGridIndex(1, 'down', 8, 4)).toBe(5);
      expect(getNextGridIndex(3, 'down', 8, 4)).toBe(7);
    });

    it('should return null when navigating down past end', () => {
      expect(getNextGridIndex(4, 'down', 8, 4)).toBeNull();
      expect(getNextGridIndex(7, 'down', 8, 4)).toBeNull();
    });

    it('should navigate up by column count', () => {
      expect(getNextGridIndex(4, 'up', 8, 4)).toBe(0);
      expect(getNextGridIndex(5, 'up', 8, 4)).toBe(1);
      expect(getNextGridIndex(7, 'up', 8, 4)).toBe(3);
    });

    it('should return null when navigating up past start', () => {
      expect(getNextGridIndex(0, 'up', 8, 4)).toBeNull();
      expect(getNextGridIndex(3, 'up', 8, 4)).toBeNull();
    });

    it('should handle single item grid', () => {
      expect(getNextGridIndex(0, 'next', 1, 1)).toBeNull();
      expect(getNextGridIndex(0, 'prev', 1, 1)).toBeNull();
      expect(getNextGridIndex(0, 'up', 1, 1)).toBeNull();
      expect(getNextGridIndex(0, 'down', 1, 1)).toBeNull();
    });

    it('should handle single row grid', () => {
      expect(getNextGridIndex(0, 'next', 4, 4)).toBe(1);
      expect(getNextGridIndex(0, 'down', 4, 4)).toBeNull();
      expect(getNextGridIndex(3, 'next', 4, 4)).toBeNull();
    });
  });

  describe('isAssetAccepted', () => {
    const mockDropZone = {
      accepts: ['character', 'location'] as (
        | 'character'
        | 'location'
        | 'prop'
        | 'voice'
        | 'music'
        | 'sfx'
      )[],
      onDrop: () => {},
    };

    it('should return true for accepted asset types', () => {
      expect(isAssetAccepted(mockDropZone, 'character')).toBe(true);
      expect(isAssetAccepted(mockDropZone, 'location')).toBe(true);
    });

    it('should return false for non-accepted asset types', () => {
      expect(isAssetAccepted(mockDropZone, 'prop')).toBe(false);
      expect(isAssetAccepted(mockDropZone, 'voice')).toBe(false);
      expect(isAssetAccepted(mockDropZone, 'music')).toBe(false);
    });
  });

  describe('getDropZoneStyle', () => {
    it('should return hasContent style when has content and not dragging', () => {
      const style = getDropZoneStyle(false, false, false, true);
      expect(style).toBe(dropZoneStyles.hasContent);
    });

    it('should return idle style when not dragging', () => {
      const style = getDropZoneStyle(false, false, false, false);
      expect(style).toBe(dropZoneStyles.idle);
    });

    it('should return active style when over and accepted', () => {
      const style = getDropZoneStyle(true, true, true, false);
      expect(style).toBe(dropZoneStyles.active);
    });

    it('should return invalid style when over but not accepted', () => {
      const style = getDropZoneStyle(true, true, false, false);
      expect(style).toBe(dropZoneStyles.invalid);
    });

    it('should return idle style when dragging but not over', () => {
      const style = getDropZoneStyle(true, false, true, false);
      expect(style).toBe(dropZoneStyles.idle);
    });
  });

  describe('snapToGrid', () => {
    it('should snap to nearest grid line within threshold', () => {
      expect(snapToGrid(105, 100, 10)).toBe(100);
      expect(snapToGrid(95, 100, 10)).toBe(100);
      expect(snapToGrid(99, 100, 10)).toBe(100);
      expect(snapToGrid(101, 100, 10)).toBe(100);
    });

    it('should not snap when outside threshold', () => {
      expect(snapToGrid(115, 100, 10)).toBe(115);
      expect(snapToGrid(85, 100, 10)).toBe(85);
    });

    it('should snap to exact grid positions', () => {
      expect(snapToGrid(100, 100, 10)).toBe(100);
      expect(snapToGrid(200, 100, 10)).toBe(200);
      expect(snapToGrid(0, 100, 10)).toBe(0);
    });

    it('should use default threshold', () => {
      expect(snapToGrid(105, 100)).toBe(100);
    });

    it('should handle different grid sizes', () => {
      expect(snapToGrid(52, 50, 5)).toBe(50);
      expect(snapToGrid(248, 50, 5)).toBe(250);
    });
  });

  describe('isMetaKeyShortcut', () => {
    it('should return true for Cmd/Ctrl shortcuts', () => {
      expect(isMetaKeyShortcut('Cmd/Ctrl+Z')).toBe(true);
      expect(isMetaKeyShortcut('Cmd/Ctrl+A')).toBe(true);
      expect(isMetaKeyShortcut('Cmd/Ctrl+Shift+Z')).toBe(true);
    });

    it('should return true for Meta shortcuts', () => {
      expect(isMetaKeyShortcut('Meta+K')).toBe(true);
    });

    it('should return false for non-meta shortcuts', () => {
      expect(isMetaKeyShortcut('Space')).toBe(false);
      expect(isMetaKeyShortcut('ArrowLeft')).toBe(false);
      expect(isMetaKeyShortcut('Shift+ArrowLeft')).toBe(false);
      expect(isMetaKeyShortcut('Enter')).toBe(false);
    });
  });

  describe('isWithinSnapThreshold', () => {
    it('should return true when within threshold', () => {
      expect(isWithinSnapThreshold(100, 105, 10)).toBe(true);
      expect(isWithinSnapThreshold(105, 100, 10)).toBe(true);
      expect(isWithinSnapThreshold(100, 100, 10)).toBe(true);
    });

    it('should return false when outside threshold', () => {
      expect(isWithinSnapThreshold(100, 115, 10)).toBe(false);
      expect(isWithinSnapThreshold(100, 85, 10)).toBe(false);
    });

    it('should return true at exact threshold boundary', () => {
      expect(isWithinSnapThreshold(100, 110, 10)).toBe(true);
      expect(isWithinSnapThreshold(100, 90, 10)).toBe(true);
    });

    it('should use default threshold', () => {
      expect(isWithinSnapThreshold(100, 105)).toBe(true);
      expect(isWithinSnapThreshold(100, 120)).toBe(false);
    });
  });
});
