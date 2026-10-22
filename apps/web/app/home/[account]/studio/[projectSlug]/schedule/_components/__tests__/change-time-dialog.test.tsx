import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChangeTimeDialog, toLocalInput } from '../change-time-dialog';
import type { ScheduleRow } from '../schedule-status-cell';

/**
 * FILM-2213. The Schedule tab's Change time: the posting rules' refusal is
 * shown with the override before anything moves, the override and the note
 * reach the action, and a second change of the same post starts from its
 * new time with the override off. (The browser screenshot is pending: the
 * local stack was down when this was written.)
 */

const actions = vi.hoisted(() => ({
  preview: vi.fn(),
  move: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@kit/publishing/server', () => ({
  previewReschedulePublishAction: actions.preview,
  reschedulePublishAction: actions.move,
}));

vi.mock('@kit/publishing/components', () => ({
  ScheduleMovesTable: (props: { moves: Array<{ publishId: string }> }) => (
    <ul>
      {props.moves.map((move) => (
        <li key={move.publishId} data-test="schedule-move">
          {move.publishId}
        </li>
      ))}
    </ul>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: actions.refresh }),
}));

vi.mock('@kit/ui/sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

afterEach(cleanup);

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
});

const ROW: ScheduleRow = {
  publishId: 'p-long',
  episodeId: 'e3',
  episodeTitle: 'Three',
  episodeNumber: 3,
  episodeSlug: 'three',
  platform: 'youtube',
  channelName: 'Story YT',
  contentType: 'full',
  title: 'Ep 3',
  status: 'scheduled',
  at: '2026-11-05T14:30:00.000Z',
  platformUrl: null,
  error: null,
  heldReason: null,
  breaking: false,
  episodeDeleted: false,
  removedReason: null,
  youtube: null,
};

const MOVES = [
  {
    publishId: 'p-long',
    episode: 'Ep 3 · Three',
    platform: 'youtube',
    kind: 'long',
    title: 'Ep 3',
    from: ROW.at,
    to: '2026-11-07T14:30:00.000Z',
  },
  {
    publishId: 'p-short',
    episode: 'Ep 3 · Three',
    platform: 'youtube',
    kind: 'short',
    title: 'S',
    from: '2026-11-06T05:30:00.000Z',
    to: '2026-11-08T05:30:00.000Z',
  },
];

const byTest = (id: string) =>
  document.querySelector(`[data-test="${id}"]`) as HTMLElement | null;

function setTime(local: string) {
  fireEvent.change(byTest('change-time-at')!, { target: { value: local } });
}

describe('Change time', () => {
  it('shows the rules’ refusal and what moves, then moves with the override and note', async () => {
    const onClose = vi.fn();
    actions.preview.mockResolvedValue({
      ok: true,
      data: {
        dryRun: true,
        moves: MOVES,
        cadenceRefusal: 'Story YT has a long video on 2026-11-09.',
        manualTime: false,
      },
    });
    actions.move.mockResolvedValue({
      ok: true,
      data: {
        dryRun: false,
        moves: MOVES,
        cadenceRefusal: null,
        manualTime: true,
      },
    });

    render(<ChangeTimeDialog row={ROW} onClose={onClose} />);

    expect((byTest('change-time-at') as HTMLInputElement).value).toBe(
      toLocalInput(ROW.at),
    );
    setTime('2026-11-07T20:00');
    fireEvent.click(byTest('change-time-save')!);

    // Refused: shown with its override, and nothing moved
    await waitFor(() => expect(byTest('change-time-refusal')).not.toBeNull());
    expect(screen.getByText(/long video on 2026-11-09/)).toBeTruthy();
    expect(
      document.querySelectorAll('[data-test="schedule-move"]'),
    ).toHaveLength(2);
    expect(actions.move).not.toHaveBeenCalled();

    fireEvent.click(byTest('change-time-override')!);
    fireEvent.change(byTest('change-time-note')!, {
      target: { value: 'testing 8 pm' },
    });
    fireEvent.click(byTest('change-time-save')!);

    await waitFor(() => expect(actions.move).toHaveBeenCalledTimes(1));
    expect(actions.move).toHaveBeenCalledWith(
      expect.objectContaining({
        episodeId: 'e3',
        contentType: 'full',
        scheduledAt: new Date('2026-11-07T20:00').toISOString(),
        ignoreCadence: true,
        note: 'testing 8 pm',
      }),
    );
    // The preview was not asked again for the same time
    expect(actions.preview).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(actions.refresh).toHaveBeenCalled();
  });

  it('a second change of the moved post starts from its new time, with the override off', async () => {
    actions.preview.mockResolvedValue({
      ok: true,
      data: {
        dryRun: true,
        moves: MOVES,
        cadenceRefusal: null,
        manualTime: false,
      },
    });
    actions.move.mockResolvedValue({
      ok: true,
      data: {
        dryRun: false,
        moves: MOVES,
        cadenceRefusal: null,
        manualTime: false,
      },
    });

    const moved = { ...ROW, at: '2026-11-07T14:30:00.000Z' };
    render(<ChangeTimeDialog row={moved} onClose={vi.fn()} />);

    expect((byTest('change-time-at') as HTMLInputElement).value).toBe(
      toLocalInput(moved.at),
    );
    expect(byTest('change-time-refusal')).toBeNull();

    setTime('2026-11-08T21:00');
    fireEvent.click(byTest('change-time-save')!);

    await waitFor(() => expect(actions.move).toHaveBeenCalledTimes(1));
    expect(actions.move).toHaveBeenCalledWith(
      expect.objectContaining({
        scheduledAt: new Date('2026-11-08T21:00').toISOString(),
        ignoreCadence: false,
      }),
    );
  });

  it('moves only this post when every platform is unticked, and says a refusal in its words', async () => {
    actions.preview.mockResolvedValue({
      ok: true,
      data: {
        dryRun: true,
        moves: [MOVES[0]],
        cadenceRefusal: null,
        manualTime: false,
      },
    });
    actions.move.mockResolvedValue({
      ok: false,
      error: 'It is being posted right now, so its time cannot change.',
    });

    render(<ChangeTimeDialog row={ROW} onClose={vi.fn()} />);

    fireEvent.click(byTest('change-time-all-platforms')!);
    setTime('2026-11-07T20:00');
    fireEvent.click(byTest('change-time-save')!);

    await waitFor(() =>
      expect(byTest('change-time-error')?.textContent).toContain(
        'being posted right now',
      ),
    );
    expect(actions.move).toHaveBeenCalledWith(
      expect.objectContaining({ publishId: 'p-long' }),
    );
    expect(actions.move.mock.calls[0]![0]).not.toHaveProperty('episodeId');
  });
});
