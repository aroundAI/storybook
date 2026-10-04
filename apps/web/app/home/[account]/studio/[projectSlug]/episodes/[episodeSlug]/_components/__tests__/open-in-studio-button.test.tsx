import {
  act,
  configure,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DesktopIntegrationProvider,
  NO_HANDLER_TIMEOUT_MS,
  OpenInStudioButton,
} from '../open-in-studio-button';

configure({ testIdAttribute: 'data-test' });

const EPISODE_ID = '0b7d4a52-6c39-4c0e-9d6f-1f2a3b4c5d6e';
const episode = { id: EPISODE_ID, status: 'ready' };

vi.mock('../episode-context-provider', () => ({
  useEpisodeContext: () => ({ accountSlug: 'team', episode }),
}));

function renderButton(enabled: boolean) {
  return render(
    <DesktopIntegrationProvider enabled={enabled}>
      <OpenInStudioButton />
    </DesktopIntegrationProvider>,
  );
}

/**
 * FILM-2005: "Open in Studio" shows for a team that turned the Studio on,
 * on an episode past storyboarding; a click with nothing to answer the
 * link opens the download sheet after 2 s, and one that hands the page off
 * does not.
 */
describe('OpenInStudioButton (FILM-2005)', () => {
  let assign: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    episode.status = 'ready';
    // The OS, which would hand the link to an app, is not here
    assign = vi
      .spyOn(window.location, 'assign')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    assign.mockRestore();
  });

  it('is absent while the team has the Studio off', () => {
    renderButton(false);

    expect(screen.queryByTestId('open-in-studio-button')).toBeNull();
  });

  it.each(['draft', 'story', 'editing'])(
    'is absent on an episode in %s',
    (status) => {
      episode.status = status;
      renderButton(true);

      expect(screen.queryByTestId('open-in-studio-button')).toBeNull();
    },
  );

  it('launches velorn://open with the origin and episode, and opens the sheet when nothing answered in 2 s', () => {
    renderButton(true);

    fireEvent.click(screen.getByTestId('open-in-studio-button'));

    const link = `velorn://open?api=${encodeURIComponent(window.location.origin)}&episode=${EPISODE_ID}`;
    expect(assign).toHaveBeenCalledWith(link);
    expect(
      screen
        .getByTestId('open-in-studio-button')
        .getAttribute('data-deep-link'),
    ).toBe(link);

    act(() => {
      vi.advanceTimersByTime(NO_HANDLER_TIMEOUT_MS - 1);
    });
    expect(screen.queryByTestId('studio-download-sheet')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('studio-download-sheet')).toBeTruthy();
    expect(
      screen.getByTestId('studio-download-token').getAttribute('href'),
    ).toBe('/home/team/settings/connected-apps');
  });

  it('does not open the sheet when the page lost focus to the app', () => {
    renderButton(true);

    fireEvent.click(screen.getByTestId('open-in-studio-button'));
    fireEvent.blur(window);

    act(() => {
      vi.advanceTimersByTime(NO_HANDLER_TIMEOUT_MS);
    });
    expect(screen.queryByTestId('studio-download-sheet')).toBeNull();
  });
});
