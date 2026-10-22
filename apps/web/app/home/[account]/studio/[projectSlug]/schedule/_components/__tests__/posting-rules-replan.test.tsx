import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ChannelCadenceDialog } from '../../../../../../../../../../packages/features/publishing/src/components/channel-cadence-dialog';

/**
 * FILM-2213. Saving a channel's posting rules re-plans what is scheduled on
 * it: the form previews the moves first ("Saving moves N scheduled
 * posts"), saves only on confirm, and then says what moved and what did
 * not. With nothing to move it saves at once, as before. The Schedule page,
 * Settings → Platforms and the Publish screen all open this dialog.
 */

const actions = vi.hoisted(() => ({
  preview: vi.fn(),
  save: vi.fn(),
}));

vi.mock(
  '../../../../../../../../../../packages/features/publishing/src/server/schedule-release-actions',
  () => ({
    previewChannelCadenceAction: actions.preview,
    saveChannelCadenceAction: actions.save,
  }),
);

afterEach(cleanup);

beforeEach(() => {
  actions.preview.mockReset();
  actions.save.mockReset();
});

const MOVE = {
  publishId: 'p1',
  episodeId: 'e2',
  episode: 'Ep 2 · Two',
  platform: 'youtube',
  connectionId: 'yt',
  kind: 'short',
  title: 'S1',
  from: '2026-11-03T05:30:00.000Z',
  to: '2026-11-02T15:30:00.000Z',
};

const result = (replan: unknown, replanRefusal: string | null = null) => ({
  ok: true,
  data: {
    connectionId: 'yt',
    contentType: 'short',
    saved: true,
    replan,
    replanRefusal,
  },
});

const byTest = (id: string) =>
  document.querySelector(`[data-test="${id}"]`) as HTMLElement | null;

function open(onSaved = vi.fn()) {
  render(
    <ChannelCadenceDialog
      channel={{
        id: '00000000-0000-4000-8000-0000000000c1',
        name: 'Story YT',
        platform: 'youtube',
      }}
      cadences={[]}
      defaultTimezone="Asia/Kolkata"
      onSaved={onSaved}
      onCancel={vi.fn()}
    />,
  );

  return onSaved;
}

describe('saving posting rules', () => {
  it('shows what saving moves, saves only on confirm, then says what moved', async () => {
    actions.preview.mockResolvedValue(
      result({
        dryRun: true,
        moves: [MOVE, { ...MOVE, publishId: 'p2' }],
        notMoved: [],
      }),
    );
    actions.save.mockResolvedValue(
      result({
        dryRun: false,
        moves: [MOVE, { ...MOVE, publishId: 'p2' }],
        notMoved: [],
      }),
    );
    const onSaved = open();

    fireEvent.click(byTest('cadence-save')!);

    await waitFor(() =>
      expect(byTest('cadence-replan-confirm')).not.toBeNull(),
    );
    expect(byTest('cadence-replan-confirm')!.textContent).toContain(
      'Saving moves 2 scheduled posts',
    );
    expect(
      document.querySelectorAll('[data-test="schedule-move"]'),
    ).toHaveLength(2);
    expect(actions.save).not.toHaveBeenCalled();

    fireEvent.click(byTest('cadence-replan-apply')!);

    await waitFor(() => expect(byTest('cadence-replan-result')).not.toBeNull());
    expect(actions.save).toHaveBeenCalledTimes(1);
    expect(byTest('cadence-replan-result')!.textContent).toContain(
      '2 scheduled posts moved',
    );

    fireEvent.click(byTest('cadence-replan-done')!);
    expect(onSaved).toHaveBeenCalled();
  });

  it('saves at once when nothing scheduled would move', async () => {
    actions.preview.mockResolvedValue(
      result({ dryRun: true, moves: [], notMoved: [] }),
    );
    actions.save.mockResolvedValue(
      result({ dryRun: false, moves: [], notMoved: [] }),
    );
    const onSaved = open();

    fireEvent.click(byTest('cadence-save')!);

    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(byTest('cadence-replan-confirm')).toBeNull();
  });

  it('says the rules are saved and why the posts did not move', async () => {
    actions.preview.mockResolvedValue(
      result({ dryRun: true, moves: [MOVE], notMoved: [] }),
    );
    actions.save.mockResolvedValue(
      result(
        null,
        'The scheduled posts could not be re-planned: YouTube said no',
      ),
    );
    open();

    fireEvent.click(byTest('cadence-save')!);
    await waitFor(() => expect(byTest('cadence-replan-apply')).not.toBeNull());
    fireEvent.click(byTest('cadence-replan-apply')!);

    await waitFor(() =>
      expect(byTest('cadence-replan-refusal')?.textContent).toContain(
        'YouTube said no',
      ),
    );
    expect(byTest('cadence-replan-result')!.textContent).toContain(
      'Posting rules saved',
    );
  });
});
