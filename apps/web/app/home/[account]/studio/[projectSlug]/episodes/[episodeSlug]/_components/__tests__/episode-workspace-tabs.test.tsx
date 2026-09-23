import { configure, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EpisodeWorkspaceTabs } from '../episode-workspace-tabs';

// The attribute the Playwright spec uses, so both read the same hooks.
configure({ testIdAttribute: 'data-test' });

const navigation = vi.hoisted(() => ({ pathname: '' }));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}));

// Every tab unlocked: story, screenplay and shot list all exist.
vi.mock('../episode-context-provider', () => ({
  useEpisodeContext: () => ({
    accountSlug: 'team',
    projectSlug: 'film',
    episode: {
      id: 'episode-id',
      slug: 'pilot',
      storyData: {},
      screenplayData: {},
      shotList: {},
      status: 'draft',
      finalVideoUrl: null,
      shots: [],
    },
  }),
}));

const BASE = '/home/team/studio/film/episodes/pilot';

function tabIds() {
  return screen
    .getAllByTestId(/^episode-tab-/)
    .map((tab) => tab.getAttribute('data-test')?.replace('episode-tab-', ''));
}

/**
 * FILM-607: the Edit Suite is retired. The workspace offers the story tabs
 * and Publish, each linking to its own page, and nothing else. The
 * Playwright spec `apps/e2e/tests/episodes/workspace-tabs.spec.ts` drives
 * the same bar in a browser; this is the deterministic half that the
 * mutation guard runs.
 */
describe('EpisodeWorkspaceTabs (FILM-607)', () => {
  beforeEach(() => {
    navigation.pathname = `${BASE}/ideation`;
  });

  it('offers the story tabs and Publish, and no Edit Suite', () => {
    render(<EpisodeWorkspaceTabs />);

    expect(tabIds()).toEqual([
      'ideation',
      'story',
      'screenplay',
      'shot-list',
      'audio',
      'publish',
    ]);
    expect(screen.queryByText('Edit Suite')).toBeNull();
  });

  it('links each tab to its page', () => {
    render(<EpisodeWorkspaceTabs />);

    expect(
      screen
        .getAllByTestId(/^episode-tab-/)
        .map((tab) => tab.getAttribute('href')),
    ).toEqual([
      `${BASE}/ideation`,
      `${BASE}/story`,
      `${BASE}/screenplay`,
      `${BASE}/visual-studio`,
      `${BASE}/audio-studio`,
      `${BASE}/publish`,
    ]);
  });

  it('marks the tab for the current page, and only that one', () => {
    navigation.pathname = `${BASE}/publish`;

    render(<EpisodeWorkspaceTabs />);

    expect(
      screen
        .getAllByTestId(/^episode-tab-/)
        .filter((tab) => tab.getAttribute('aria-current') === 'page')
        .map((tab) => tab.getAttribute('data-test')),
    ).toEqual(['episode-tab-publish']);
  });
});
