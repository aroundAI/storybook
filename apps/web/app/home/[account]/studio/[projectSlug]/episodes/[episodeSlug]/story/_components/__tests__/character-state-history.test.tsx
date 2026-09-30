import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  characterHistory,
  describeStateValue,
  rollbackableDeltaId,
} from '../character-history';
import { CharacterStateHistory } from '../character-state-history';

/**
 * FILM-1005: the canon dashboard calls rollbackCharacterStateAction from a
 * Rollback control on a character's history.
 */

configure({ testIdAttribute: 'data-test' });

const EPISODE = 'episode-1';
const MARA = 'char-mara';

const actions = vi.hoisted(() => ({
  getStateDeltasAction: vi.fn(),
  rollbackCharacterStateAction: vi.fn(),
}));

vi.mock('@kit/episodes/server', () => actions);
vi.mock('@kit/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const older = {
  id: 'delta-1',
  entity_type: 'character',
  entity_id: MARA,
  before_state: { state: 'hopeful' },
  after_state: { state: 'wary' },
  change_reason: 'The gate falls',
  created_at: '2026-10-01T10:00:00Z',
};

const newest = {
  id: 'delta-2',
  entity_type: 'character',
  entity_id: MARA,
  before_state: { state: 'wary' },
  after_state: { state: 'grieving' },
  change_reason: 'Her brother dies',
  created_at: '2026-10-01T11:00:00Z',
};

const otherCharacter = {
  ...newest,
  id: 'delta-3',
  entity_id: 'char-other',
  created_at: '2026-10-01T12:00:00Z',
};

const thread = { ...newest, id: 'delta-4', entity_type: 'thread' };

function renderHistory(onRolledBack = vi.fn()) {
  render(
    <CharacterStateHistory
      characterId={MARA}
      characterName="Mara"
      episodeId={EPISODE}
      onRolledBack={onRolledBack}
    />,
  );
  return onRolledBack;
}

async function openHistory() {
  fireEvent.click(screen.getByTestId('canon-character-history-toggle'));
  await screen.findAllByTestId('canon-character-delta');
}

beforeEach(() => {
  vi.clearAllMocks();
  actions.getStateDeltasAction.mockResolvedValue([
    otherCharacter,
    thread,
    older,
    newest,
  ]);
});

afterEach(cleanup);

describe('character history helpers', () => {
  it("keeps the character's own changes, newest first", () => {
    const history = characterHistory(
      [older, otherCharacter, thread, newest],
      MARA,
    );

    expect(history.map((delta) => delta.id)).toEqual(['delta-2', 'delta-1']);
  });

  it('offers a rollback of the newest change only', () => {
    expect(rollbackableDeltaId([newest, older])).toBe('delta-2');
  });

  it('offers none when the newest change is the first state recorded', () => {
    expect(rollbackableDeltaId([{ ...older, before_state: null }])).toBeNull();
    expect(rollbackableDeltaId([])).toBeNull();
  });

  it('reads a state value the way it was written', () => {
    expect(describeStateValue({ state: 'grieving' })).toBe('grieving');
    expect(describeStateValue({ arc: 'Learns to trust', role: 'lead' })).toBe(
      'Learns to trust',
    );
    expect(describeStateValue(null)).toBe('none');
    expect(describeStateValue({ other: 1 })).toBe('{"other":1}');
  });
});

describe('CharacterStateHistory', () => {
  it('lists only this character and puts Rollback on the newest change', async () => {
    renderHistory();
    await openHistory();

    const rows = screen.getAllByTestId('canon-character-delta');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('grieving');
    expect(
      rows[0]!.querySelector('[data-test="canon-character-rollback"]'),
    ).not.toBeNull();
    expect(
      rows[1]!.querySelector('[data-test="canon-character-rollback"]'),
    ).toBeNull();
  });

  it('shows no Rollback when the only change is the first state', async () => {
    actions.getStateDeltasAction.mockResolvedValue([
      { ...older, before_state: null },
    ]);
    renderHistory();
    await openHistory();

    expect(screen.queryByTestId('canon-character-rollback')).toBeNull();
  });

  it('says so when the episode recorded nothing for the character', async () => {
    actions.getStateDeltasAction.mockResolvedValue([]);
    renderHistory();
    fireEvent.click(screen.getByTestId('canon-character-history-toggle'));

    await screen.findByTestId('canon-character-history-empty');
  });

  it('rolls back after a confirmation, then reloads and tells the dashboard', async () => {
    actions.rollbackCharacterStateAction.mockResolvedValue({
      ok: true,
      data: { restoredStateType: 'emotional' },
    });
    const onRolledBack = renderHistory();
    await openHistory();

    fireEvent.click(screen.getByTestId('canon-character-rollback'));
    expect(actions.rollbackCharacterStateAction).not.toHaveBeenCalled();

    fireEvent.click(
      await screen.findByTestId('canon-character-rollback-confirm'),
    );

    await waitFor(() => expect(onRolledBack).toHaveBeenCalledTimes(1));
    expect(actions.rollbackCharacterStateAction).toHaveBeenCalledWith({
      deltaId: 'delta-2',
    });
    expect(actions.getStateDeltasAction).toHaveBeenCalledTimes(2);
  });

  it('shows a refusal in the dialog and leaves the state alone', async () => {
    actions.rollbackCharacterStateAction.mockResolvedValue({
      ok: false,
      error:
        'The character changed again after this. Roll back the later change first.',
    });
    const onRolledBack = renderHistory();
    await openHistory();

    fireEvent.click(screen.getByTestId('canon-character-rollback'));
    fireEvent.click(
      await screen.findByTestId('canon-character-rollback-confirm'),
    );

    const error = await screen.findByTestId('canon-character-rollback-error');
    expect(error.textContent).toContain('Roll back the later change first');
    expect(onRolledBack).not.toHaveBeenCalled();
    expect(actions.getStateDeltasAction).toHaveBeenCalledTimes(1);
  });
});
