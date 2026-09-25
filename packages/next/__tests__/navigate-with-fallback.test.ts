import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { navigateWithFallback } from '../src/navigation/navigate-with-fallback';

/**
 * KB-117: a soft navigation that never commits must not leave the page
 * where it was. The browser is a stubbed `window.location`; the router is a
 * spy that either "commits" (moves the address) or stalls.
 */
describe('navigateWithFallback', () => {
  let location: {
    pathname: string;
    search: string;
    assign: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    location = {
      pathname: '/home/team/studio/projects/new',
      search: '',
      assign: vi.fn(),
    };
    vi.stubGlobal('window', { location });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const committing = {
    push: vi.fn((href: string) => {
      location.pathname = href;
    }),
  };
  const stalling = { push: vi.fn() };

  it('pushes softly first', () => {
    navigateWithFallback(stalling, '/home/team/studio/night-ferry');

    expect(stalling.push).toHaveBeenCalledWith('/home/team/studio/night-ferry');
    expect(location.assign).not.toHaveBeenCalled();
  });

  it('falls back to a hard navigation when the soft one never commits', () => {
    navigateWithFallback(stalling, '/home/team/studio/night-ferry');

    vi.advanceTimersByTime(4_999);
    expect(location.assign).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(location.assign).toHaveBeenCalledExactlyOnceWith(
      '/home/team/studio/night-ferry',
    );
  });

  it('does nothing more when the soft navigation commits', () => {
    navigateWithFallback(committing, '/home/team/studio/night-ferry');

    vi.runAllTimers();
    expect(location.assign).not.toHaveBeenCalled();
  });

  it('does not pull the user back after they have navigated elsewhere', () => {
    navigateWithFallback(stalling, '/home/team/studio/night-ferry');
    location.pathname = '/home/team/settings';

    vi.runAllTimers();
    expect(location.assign).not.toHaveBeenCalled();
  });

  it('honours a custom bound', () => {
    navigateWithFallback(stalling, '/x', { fallbackAfterMs: 100 });

    vi.advanceTimersByTime(100);
    expect(location.assign).toHaveBeenCalledWith('/x');
  });
});
