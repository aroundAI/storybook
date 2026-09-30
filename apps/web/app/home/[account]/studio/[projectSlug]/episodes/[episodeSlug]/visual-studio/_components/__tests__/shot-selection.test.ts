import { describe, expect, it } from 'vitest';

import {
  EMPTY_SELECTION,
  nextFocusIndex,
  orderedShotIds,
  selectShot,
} from '../shot-selection';

const ORDER = ['a', 'b', 'c', 'd', 'e'];
const PLAIN = { toggle: false, range: false };
const TOGGLE = { toggle: true, range: false };
const RANGE = { toggle: false, range: true };

describe('selectShot (FILM-410)', () => {
  it('selects one shot on a plain click and replaces the previous selection', () => {
    const first = selectShot(EMPTY_SELECTION, ORDER, 'b', PLAIN);
    const second = selectShot(first, ORDER, 'd', PLAIN);

    expect(first).toEqual({
      selectedIds: ['b'],
      anchorId: 'b',
      primaryId: 'b',
    });
    expect(second).toEqual({
      selectedIds: ['d'],
      anchorId: 'd',
      primaryId: 'd',
    });
  });

  it('adds a shot on Cmd/Ctrl-click and makes it the primary shot', () => {
    const selection = selectShot(
      selectShot(EMPTY_SELECTION, ORDER, 'a', PLAIN),
      ORDER,
      'd',
      TOGGLE,
    );

    expect(selection).toEqual({
      selectedIds: ['a', 'd'],
      anchorId: 'd',
      primaryId: 'd',
    });
  });

  it('removes a selected shot on Cmd/Ctrl-click and falls back to the last remaining one', () => {
    const selection = selectShot(
      { selectedIds: ['a', 'c', 'd'], anchorId: 'd', primaryId: 'd' },
      ORDER,
      'd',
      TOGGLE,
    );

    expect(selection.selectedIds).toEqual(['a', 'c']);
    expect(selection.primaryId).toBe('c');
  });

  it('leaves no primary shot when the last selected shot is toggled off', () => {
    const selection = selectShot(
      { selectedIds: ['b'], anchorId: 'b', primaryId: 'b' },
      ORDER,
      'b',
      TOGGLE,
    );

    expect(selection.selectedIds).toEqual([]);
    expect(selection.primaryId).toBeNull();
  });

  it('selects every shot between the anchor and the Shift-clicked shot, in either direction', () => {
    const anchored = selectShot(EMPTY_SELECTION, ORDER, 'b', PLAIN);

    expect(selectShot(anchored, ORDER, 'd', RANGE).selectedIds).toEqual([
      'b',
      'c',
      'd',
    ]);
    expect(selectShot(anchored, ORDER, 'a', RANGE).selectedIds).toEqual([
      'a',
      'b',
    ]);
  });

  it('keeps the anchor across successive Shift-clicks', () => {
    const anchored = selectShot(EMPTY_SELECTION, ORDER, 'b', PLAIN);
    const wide = selectShot(anchored, ORDER, 'e', RANGE);
    const narrow = selectShot(wide, ORDER, 'c', RANGE);

    expect(narrow.selectedIds).toEqual(['b', 'c']);
    expect(narrow.anchorId).toBe('b');
    expect(narrow.primaryId).toBe('c');
  });

  it('adds the range to the existing selection when Cmd/Ctrl is held too', () => {
    const selection = selectShot(
      { selectedIds: ['a', 'd'], anchorId: 'd', primaryId: 'd' },
      ORDER,
      'e',
      { toggle: true, range: true },
    );

    expect(selection.selectedIds).toEqual(['a', 'd', 'e']);
  });

  it('treats Shift-click without an anchor as a plain click', () => {
    expect(selectShot(EMPTY_SELECTION, ORDER, 'c', RANGE)).toEqual({
      selectedIds: ['c'],
      anchorId: 'c',
      primaryId: 'c',
    });
  });

  it('treats Shift-click as plain when the anchor was filtered out of the grid', () => {
    const selection = selectShot(
      { selectedIds: ['gone'], anchorId: 'gone', primaryId: 'gone' },
      ORDER,
      'c',
      RANGE,
    );

    expect(selection.selectedIds).toEqual(['c']);
  });
});

describe('orderedShotIds', () => {
  it('lists shots scene by scene in numeric scene order', () => {
    const shot = (id: string) => ({ id }) as never;

    expect(
      orderedShotIds({
        10: [shot('c')],
        2: [shot('a'), shot('b')],
      }),
    ).toEqual(['a', 'b', 'c']);
  });
});

describe('nextFocusIndex', () => {
  const sceneLengths = [5, 3];
  const move = (
    key: Parameters<typeof nextFocusIndex>[0]['key'],
    index: number,
  ) => nextFocusIndex({ key, index, sceneLengths, columns: 2 });

  it('steps through every card with left and right, across scenes', () => {
    expect(move('ArrowRight', 4)).toBe(5);
    expect(move('ArrowLeft', 5)).toBe(4);
    expect(move('ArrowLeft', 0)).toBe(0);
    expect(move('ArrowRight', 7)).toBe(7);
  });

  it('moves a row up and down by the column count', () => {
    expect(move('ArrowDown', 0)).toBe(2);
    expect(move('ArrowUp', 3)).toBe(1);
  });

  it('lands on the last card when the row below is a short last row', () => {
    expect(move('ArrowDown', 3)).toBe(4);
  });

  it('continues into the next scene from the bottom row, keeping the column', () => {
    expect(move('ArrowDown', 4)).toBe(5);
    expect(
      nextFocusIndex({
        key: 'ArrowDown',
        index: 3,
        sceneLengths: [4, 3],
        columns: 2,
      }),
    ).toBe(5);
  });

  it('continues into the last row of the previous scene from the top row', () => {
    expect(move('ArrowUp', 5)).toBe(4);
    expect(move('ArrowUp', 6)).toBe(4);
    expect(
      nextFocusIndex({
        key: 'ArrowUp',
        index: 5,
        sceneLengths: [4, 3],
        columns: 2,
      }),
    ).toBe(3);
  });

  it('stays put at the grid edges', () => {
    expect(move('ArrowUp', 0)).toBe(0);
    expect(move('ArrowDown', 7)).toBe(7);
  });

  it('jumps to the first and last card of the scene with Home and End', () => {
    expect(move('Home', 3)).toBe(0);
    expect(move('End', 1)).toBe(4);
    expect(move('Home', 7)).toBe(5);
    expect(move('End', 5)).toBe(7);
  });
});
