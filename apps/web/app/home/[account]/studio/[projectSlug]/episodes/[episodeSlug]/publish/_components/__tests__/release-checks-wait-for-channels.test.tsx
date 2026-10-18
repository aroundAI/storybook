import {
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScheduleReleasePanel } from '@kit/publishing/components';

/**
 * KB-198: until the project's channels are read, the calendar check and
 * the breaking preview cannot be clicked, so an early click is not
 * answered "still loading" and asked again.
 */

configure({ testIdAttribute: 'data-test' });

afterEach(cleanup);

function panel(channelsLoading: boolean) {
  return (
    <ScheduleReleasePanel
      fullVideoLanguages={['en']}
      shortsGroups={[]}
      baseMetadata={{ title: 'Episode', description: '' }}
      onSchedule={vi.fn()}
      onPublishNow={vi.fn()}
      onPreviewCadence={vi.fn()}
      onPreviewBreaking={vi.fn()}
      channelsLoading={channelsLoading}
    />
  );
}

function pickToday() {
  fireEvent.click(screen.getByTestId('release-date'));
  const now = new Date();
  const today = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
  const cell = document.querySelector(
    `[role="gridcell"][data-day="${today}"] button`,
  );
  if (!cell) throw new Error(`no calendar cell for ${today}`);
  fireEvent.click(cell);
}

describe('KB-198: release checks wait for the channels', () => {
  it('the calendar check is disabled and loading until the channels load', () => {
    const { rerender } = render(panel(true));
    pickToday();

    const check = screen.getByTestId('release-check-calendar');
    expect(check).toBeDisabled();
    expect(check).toHaveAttribute('data-loading', 'true');
    expect(check).toHaveAttribute('aria-busy', 'true');
    expect(check).toHaveTextContent('Loading channels…');

    rerender(panel(false));

    expect(check).toBeEnabled();
    expect(check).not.toHaveAttribute('data-loading');
    expect(check).toHaveTextContent('Check channel calendars');
  });

  it('the breaking preview is disabled and loading until the channels load', () => {
    const { rerender } = render(panel(true));
    fireEvent.mouseDown(screen.getByTestId('release-mode-breaking'), {
      button: 0,
    });

    const preview = screen.getByTestId('breaking-preview');
    expect(preview).toBeDisabled();
    expect(preview).toHaveAttribute('data-loading', 'true');
    expect(preview).toHaveTextContent('Loading channels…');

    rerender(panel(false));

    expect(preview).toBeEnabled();
    expect(preview).not.toHaveAttribute('data-loading');
    expect(preview).toHaveTextContent('Preview breaking release');
  });
});
