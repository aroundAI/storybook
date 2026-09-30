import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CanonDashboard } from '../canon-dashboard';

/**
 * FILM-1007: the Events, Threads and Characters tabs render what the canon
 * actions return, and the Characters tab carries the Rollback control
 * (FILM-1005).
 */

configure({ testIdAttribute: 'data-test' });

const actions = vi.hoisted(() => ({
  getImmutableEventsAction: vi.fn(),
  getActiveThreadsAction: vi.fn(),
  getProjectCharacterStatesAction: vi.fn(),
  getStateDeltasAction: vi.fn(),
  rollbackCharacterStateAction: vi.fn(),
  deleteImmutableEventAction: vi.fn(),
}));

vi.mock('@kit/episodes/server', () => actions);
vi.mock('@kit/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('../add-event-dialog', () => ({ AddEventDialog: () => null }));
vi.mock('../add-thread-dialog', () => ({ AddThreadDialog: () => null }));
vi.mock('../edit-thread-dialog', () => ({ EditThreadDialog: () => null }));
vi.mock('../update-character-state-dialog', () => ({
  UpdateCharacterStateDialog: () => null,
}));
vi.mock('../episode-facts-panel', () => ({ EpisodeFactsPanel: () => null }));

const PROJECT = 'project-1';
const EPISODE = 'episode-1';

const event = {
  id: 'event-1',
  eventType: 'death',
  eventKey: 'character:mara:dead',
  description: 'Mara dies defending the gate',
  episodeNumber: 2,
  createdAt: '2026-10-01T10:00:00Z',
};

const thread = {
  id: 'thread-1',
  threadName: "Maya's Missing Mother",
  description: 'Where did she go?',
  status: 'open',
};

const states = [
  {
    id: 'state-2',
    character_id: 'char-mara',
    state_type: 'emotional',
    state_value: { state: 'grieving' },
    trigger_event: 'story_generation',
    characters: { name: 'Mara' },
  },
  {
    id: 'state-1',
    character_id: 'char-mara',
    state_type: 'goal',
    state_value: { arc: 'x' },
    trigger_event: null,
    characters: { name: 'Mara' },
  },
];

function renderDashboard(canonEnabled = true) {
  render(
    <CanonDashboard
      projectId={PROJECT}
      episodeId={EPISODE}
      episodeNumber={2}
      canonEnabled={canonEnabled}
    />,
  );
}

function openTab(name: RegExp) {
  fireEvent.mouseDown(screen.getByRole('tab', { name }), { button: 0 });
}

beforeEach(() => {
  vi.clearAllMocks();
  actions.getImmutableEventsAction.mockResolvedValue([event]);
  actions.getActiveThreadsAction.mockResolvedValue([thread]);
  actions.getProjectCharacterStatesAction.mockResolvedValue(states);
  actions.getStateDeltasAction.mockResolvedValue([]);
});

afterEach(cleanup);

describe('CanonDashboard', () => {
  it('reads no canon when it is disabled, and says so', () => {
    renderDashboard(false);

    expect(screen.getByText('Canon Management Disabled')).toBeTruthy();
    expect(actions.getImmutableEventsAction).not.toHaveBeenCalled();
  });

  it('renders the events with their key, episode and a delete control', async () => {
    renderDashboard();

    const card = await screen.findByTestId('canon-event');
    expect(card.textContent).toContain('Mara dies defending the gate');
    expect(card.textContent).toContain('character:mara:dead');
    expect(card.textContent).toContain('Ep.2');
    expect(
      card.querySelector('[data-test="canon-event-delete"]'),
    ).not.toBeNull();
  });

  it('renders the threads with their status', async () => {
    renderDashboard();
    await screen.findByTestId('canon-event');

    openTab(/threads/i);

    const card = await screen.findByTestId('canon-thread');
    expect(card.textContent).toContain("Maya's Missing Mother");
    expect(card.textContent).toContain('Where did she go?');
    expect(card.textContent).toContain('open');
  });

  it('renders the character states with a readable type and trigger', async () => {
    renderDashboard();
    await screen.findByTestId('canon-event');

    openTab(/characters/i);

    await screen.findByTestId('canon-character-history');
    expect(screen.getByText('Emotional')).toBeTruthy();
    expect(screen.getByText('Auto-generated from story')).toBeTruthy();
  });

  it('offers one history per character, on its latest state', async () => {
    renderDashboard();
    await screen.findByTestId('canon-event');

    openTab(/characters/i);

    await screen.findByTestId('canon-character-history');
    expect(screen.getAllByTestId('canon-character-history')).toHaveLength(1);
  });

  it('reloads the canon after a rollback, so the characters tab shows the new state', async () => {
    actions.getStateDeltasAction.mockResolvedValue([
      {
        id: 'delta-1',
        entity_type: 'character',
        entity_id: 'char-mara',
        before_state: { state: 'wary' },
        after_state: { state: 'grieving' },
        change_reason: 'Her brother dies',
        created_at: '2026-10-01T11:00:00Z',
      },
    ]);
    actions.rollbackCharacterStateAction.mockResolvedValue({
      ok: true,
      data: { restoredStateType: 'emotional' },
    });
    renderDashboard();
    await screen.findByTestId('canon-event');
    openTab(/characters/i);

    fireEvent.click(
      await screen.findByTestId('canon-character-history-toggle'),
    );
    fireEvent.click(await screen.findByTestId('canon-character-rollback'));
    fireEvent.click(
      await screen.findByTestId('canon-character-rollback-confirm'),
    );

    await waitFor(() =>
      expect(actions.getProjectCharacterStatesAction).toHaveBeenCalledTimes(2),
    );
    expect(actions.rollbackCharacterStateAction).toHaveBeenCalledWith({
      deltaId: 'delta-1',
    });
  });
});
