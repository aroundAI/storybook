import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EpisodeSummaryGenerator } from '../episode-summary-generator';

/**
 * FILM-1007: the publish page extracts canon changes from the story, shows
 * them for review, and commits them once.
 */

configure({ testIdAttribute: 'data-test' });

const actions = vi.hoisted(() => ({
  extractCanonChangesAction: vi.fn(),
  commitCanonChangesAction: vi.fn(),
}));

vi.mock('@kit/episodes/server', () => actions);
vi.mock('@kit/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const PROJECT = 'project-1';
const EPISODE = 'episode-1';
const STORY = 'Mara held the gate until the last light. '.repeat(5);

const extraction = {
  episodeSummary: 'Mara holds the gate and dies.',
  sentimentScore: 0.2,
  immutableEvents: [
    {
      type: 'death',
      eventKey: 'character:mara:dead',
      description: 'Mara dies',
      confidence: 'high',
    },
    {
      type: 'world_fact',
      eventKey: 'world:gate:open',
      description: 'The gate may be open',
      confidence: 'low',
    },
  ],
  threadUpdates: [
    {
      threadName: 'The missing key',
      action: 'open',
      description: 'Who took it?',
      promises: ['Who took the key'],
    },
  ],
  keyEvents: ['Mara dies'],
  characterChanges: ['Mara: hopeful -> gone'],
  worldState: { location: 'The north gate' },
};

function renderGenerator(storyContent = STORY) {
  render(
    <EpisodeSummaryGenerator
      projectId={PROJECT}
      episodeId={EPISODE}
      episodeNumber={2}
      season={1}
      storyContent={storyContent}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  actions.extractCanonChangesAction.mockResolvedValue(extraction);
  actions.commitCanonChangesAction.mockResolvedValue({
    eventsCreated: 1,
    threadsUpdated: 1,
    summaryStored: true,
  });
});

afterEach(cleanup);

describe('EpisodeSummaryGenerator', () => {
  it('extracts from the story on load and shows the changes for review', async () => {
    renderGenerator();

    const events = await screen.findAllByTestId('canon-extracted-event');
    expect(actions.extractCanonChangesAction).toHaveBeenCalledWith({
      projectId: PROJECT,
      episodeId: EPISODE,
      storyContent: STORY,
    });
    expect(events).toHaveLength(2);
    expect(events[0]!.textContent).toContain('Mara dies');
    expect(events[0]!.textContent).toContain('high');
    expect(screen.getAllByTestId('canon-extracted-thread')).toHaveLength(1);
    expect(
      (screen.getByTestId('canon-episode-summary') as HTMLTextAreaElement)
        .value,
    ).toBe('Mara holds the gate and dies.');
  });

  it('extracts nothing when the story is too short to analyse', () => {
    renderGenerator('Short.');

    expect(actions.extractCanonChangesAction).not.toHaveBeenCalled();
    expect(screen.queryByTestId('canon-commit')).toBeNull();
  });

  it('commits the reviewed changes, with the edited summary and the memory rows', async () => {
    renderGenerator();
    await screen.findAllByTestId('canon-extracted-event');

    fireEvent.change(screen.getByTestId('canon-episode-summary'), {
      target: { value: 'Mara holds the gate.' },
    });
    fireEvent.click(screen.getByTestId('canon-commit'));

    await waitFor(() =>
      expect(actions.commitCanonChangesAction).toHaveBeenCalledTimes(1),
    );
    expect(actions.commitCanonChangesAction).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT,
        episodeId: EPISODE,
        season: 1,
        episodeNumber: 2,
        changes: expect.objectContaining({
          episodeSummary: 'Mara holds the gate.',
          sentimentScore: 0.2,
          keyEvents: ['Mara dies'],
          characterChanges: ['Mara: hopeful -> gone'],
          worldState: { location: 'The north gate' },
        }),
      }),
    );
  });

  it('cannot commit twice: the events are unique per project', async () => {
    renderGenerator();
    await screen.findAllByTestId('canon-extracted-event');

    fireEvent.click(screen.getByTestId('canon-commit'));

    await waitFor(() =>
      expect(screen.getByTestId('canon-commit').textContent).toContain(
        'Saved to Canon',
      ),
    );
    expect(
      (screen.getByTestId('canon-commit') as HTMLButtonElement).disabled,
    ).toBe(true);

    fireEvent.click(screen.getByTestId('canon-commit'));
    expect(actions.commitCanonChangesAction).toHaveBeenCalledTimes(1);
  });

  it('lets a failed commit be tried again', async () => {
    actions.commitCanonChangesAction.mockRejectedValueOnce(new Error('x'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renderGenerator();
    await screen.findAllByTestId('canon-extracted-event');

    fireEvent.click(screen.getByTestId('canon-commit'));
    await waitFor(() =>
      expect(actions.commitCanonChangesAction).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(
        (screen.getByTestId('canon-commit') as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    expect(screen.getByTestId('canon-commit').textContent).toContain(
      'Save to Canon',
    );
  });

  it('re-analysing after a save offers the commit again', async () => {
    renderGenerator();
    await screen.findAllByTestId('canon-extracted-event');
    fireEvent.click(screen.getByTestId('canon-commit'));
    await waitFor(() =>
      expect(screen.getByTestId('canon-commit').textContent).toContain(
        'Saved to Canon',
      ),
    );

    fireEvent.click(screen.getByTestId('canon-analyze'));

    await waitFor(() =>
      expect(screen.getByTestId('canon-commit').textContent).toContain(
        'Save to Canon',
      ),
    );
  });
});
