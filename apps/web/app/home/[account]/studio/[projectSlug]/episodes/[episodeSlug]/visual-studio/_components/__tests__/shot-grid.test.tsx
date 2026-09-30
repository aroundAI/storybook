import { configure, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Shot } from '@kit/episodes/types';

import { ShotGrid } from '../shot-grid';

configure({ testIdAttribute: 'data-test' });

const shot = (id: string, sceneNumber: number, shotNumber: number) =>
  ({
    id,
    sceneNumber,
    shotNumber,
    description: `Action ${id}`,
    status: 'pending',
    metadata: null,
  }) as unknown as Shot;

const shotsByScene = {
  1: [shot('a', 1, 1), shot('b', 1, 2)],
  2: [shot('c', 2, 1)],
};

function renderGrid(selected: string[] = []) {
  const onShotSelect = vi.fn();
  const onClearSelection = vi.fn();

  render(
    <ShotGrid
      shotsByScene={shotsByScene}
      selectedShotIds={new Set(selected)}
      onShotSelect={onShotSelect}
      onClearSelection={onClearSelection}
    />,
  );

  return { onShotSelect, onClearSelection };
}

/**
 * FILM-410: the grid is a multi-select listbox per scene, its cards are
 * keyboard reachable, and modifier keys reach the selection model.
 */
describe('ShotGrid (FILM-410)', () => {
  it('exposes a labelled multi-select listbox per scene of options', () => {
    renderGrid(['b']);

    const listbox = screen.getByRole('listbox', { name: 'Scene 1 shots' });
    expect(listbox.getAttribute('aria-multiselectable')).toBe('true');
    expect(screen.getAllByRole('listbox')).toHaveLength(2);

    const selected = screen.getByRole('option', { selected: true });
    expect(selected.getAttribute('aria-label')).toBe('Shot 1.2: Action b');
    expect(screen.getAllByRole('option', { selected: false })).toHaveLength(2);
  });

  it('makes one card the tab stop', () => {
    renderGrid();

    const tabStops = screen
      .getAllByRole('option')
      .filter((card) => card.getAttribute('tabindex') === '0');

    expect(tabStops).toHaveLength(1);
    expect(tabStops[0]?.getAttribute('data-shot-id')).toBe('a');
  });

  it('passes Cmd/Ctrl and Shift from a click to the selection', () => {
    const { onShotSelect } = renderGrid();
    const [first, second, third] = screen.getAllByRole('option');

    fireEvent.click(first!);
    fireEvent.click(second!, { metaKey: true });
    fireEvent.click(third!, { shiftKey: true });

    expect(onShotSelect.mock.calls.map(([, modifiers]) => modifiers)).toEqual([
      { toggle: false, range: false },
      { toggle: true, range: false },
      { toggle: false, range: true },
    ]);
    expect(onShotSelect.mock.calls[2]?.[0].id).toBe('c');
  });

  it('selects the focused card with Enter and Space', () => {
    const { onShotSelect } = renderGrid();
    const [first, second] = screen.getAllByRole('option');

    fireEvent.keyDown(first!, { key: 'Enter' });
    fireEvent.keyDown(second!, { key: ' ' });

    expect(onShotSelect.mock.calls.map(([picked]) => picked.id)).toEqual([
      'a',
      'b',
    ]);
  });

  it('moves focus with the arrow keys, Home and End, and clears on Escape', () => {
    const { onClearSelection } = renderGrid();
    const [first, second, third] = screen.getAllByRole('option');

    first!.focus();
    fireEvent.keyDown(first!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(second);

    fireEvent.keyDown(second!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(third);

    fireEvent.keyDown(third!, { key: 'Home' });
    expect(document.activeElement).toBe(third);

    fireEvent.keyDown(second!, { key: 'Home' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first!, { key: 'Escape' });
    expect(onClearSelection).toHaveBeenCalledOnce();
  });

  it('gives the grid up to six columns at wide breakpoints', () => {
    renderGrid();

    const className = screen.getAllByTestId('shot-grid')[0]!.className;

    expect(className).toContain('grid-cols-1');
    expect(className).toContain('2xl:grid-cols-6');
  });
});
