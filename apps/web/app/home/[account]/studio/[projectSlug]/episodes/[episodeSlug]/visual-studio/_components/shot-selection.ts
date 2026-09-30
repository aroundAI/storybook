import type { Shot } from '@kit/episodes/types';

export interface ShotSelection {
  selectedIds: string[];
  anchorId: string | null;
  primaryId: string | null;
}

export interface SelectionModifiers {
  toggle: boolean;
  range: boolean;
}

export const EMPTY_SELECTION: ShotSelection = {
  selectedIds: [],
  anchorId: null,
  primaryId: null,
};

export type NavigationKey =
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'Home'
  | 'End';

export const NAVIGATION_KEYS: readonly string[] = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
];

export function isNavigationKey(key: string): key is NavigationKey {
  return NAVIGATION_KEYS.includes(key);
}

export function orderedShotIds(shotsByScene: Record<number, Shot[]>): string[] {
  return Object.entries(shotsByScene)
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .flatMap(([, shots]) => shots.map((shot) => shot.id));
}

/**
 * Plain click selects one shot, Cmd/Ctrl-click toggles it in or out of the
 * selection, Shift-click selects everything between the anchor and the
 * clicked shot in grid order (added to the selection when Cmd/Ctrl is held).
 */
export function selectShot(
  selection: ShotSelection,
  orderedIds: string[],
  id: string,
  modifiers: SelectionModifiers,
): ShotSelection {
  const anchorIndex = selection.anchorId
    ? orderedIds.indexOf(selection.anchorId)
    : -1;
  const clickedIndex = orderedIds.indexOf(id);

  if (modifiers.range && anchorIndex !== -1 && clickedIndex !== -1) {
    const [from, to] =
      anchorIndex < clickedIndex
        ? [anchorIndex, clickedIndex]
        : [clickedIndex, anchorIndex];
    const rangeIds = orderedIds.slice(from, to + 1);
    const selectedIds = modifiers.toggle
      ? orderedIds.filter(
          (orderedId) =>
            selection.selectedIds.includes(orderedId) ||
            rangeIds.includes(orderedId),
        )
      : rangeIds;

    return { selectedIds, anchorId: selection.anchorId, primaryId: id };
  }

  if (modifiers.toggle) {
    if (selection.selectedIds.includes(id)) {
      const selectedIds = selection.selectedIds.filter(
        (selectedId) => selectedId !== id,
      );

      return {
        selectedIds,
        anchorId: id,
        primaryId: selectedIds.at(-1) ?? null,
      };
    }

    return {
      selectedIds: [...selection.selectedIds, id],
      anchorId: id,
      primaryId: id,
    };
  }

  return { selectedIds: [id], anchorId: id, primaryId: id };
}

interface NextFocusInput {
  key: NavigationKey;
  index: number;
  sceneLengths: number[];
  columns: number;
}

/**
 * Where focus goes for a navigation key. Cards are numbered across scenes in
 * grid order. Left and right step through every card; up and down move a row
 * within a scene and continue into the neighbouring scene at its edge; Home
 * and End jump to the first and last card of the scene.
 */
export function nextFocusIndex({
  key,
  index,
  sceneLengths,
  columns,
}: NextFocusInput): number {
  const total = sceneLengths.reduce((sum, length) => sum + length, 0);

  if (index < 0 || index >= total) {
    return Math.max(0, Math.min(index, total - 1));
  }

  let sceneIndex = 0;
  let start = 0;
  while (index >= start + sceneLengths[sceneIndex]!) {
    start += sceneLengths[sceneIndex]!;
    sceneIndex += 1;
  }

  const length = sceneLengths[sceneIndex]!;
  const local = index - start;
  const column = local % columns;

  switch (key) {
    case 'ArrowLeft':
      return Math.max(0, index - 1);
    case 'ArrowRight':
      return Math.min(total - 1, index + 1);
    case 'Home':
      return start;
    case 'End':
      return start + length - 1;
    case 'ArrowDown': {
      if (local + columns < length) return index + columns;

      const lastRowStart = Math.floor((length - 1) / columns) * columns;
      if (local < lastRowStart) return start + length - 1;

      const nextLength = sceneLengths[sceneIndex + 1];
      if (nextLength === undefined) return index;

      return start + length + Math.min(column, nextLength - 1);
    }
    case 'ArrowUp': {
      if (local - columns >= 0) return index - columns;

      const previousLength = sceneLengths[sceneIndex - 1];
      if (previousLength === undefined) return index;

      const previousLastRowStart =
        Math.floor((previousLength - 1) / columns) * columns;

      return (
        start -
        previousLength +
        Math.min(previousLastRowStart + column, previousLength - 1)
      );
    }
  }
}
