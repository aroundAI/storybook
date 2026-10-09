import { configure, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EpisodeWorkspaceTabs } from '../episode-workspace-tabs';

// The attribute the Playwright spec uses, so both read the same hooks.
configure({ testIdAttribute: 'data-test' });

const navigation = vi.hoisted(() => ({ pathname: '' }));
const fixture = vi.hoisted(() => ({
  episode: {} as Record<string, unknown>,
}));

// The paste dialog is not under test here
vi.mock('../import-script-dialog', () => ({ ImportScriptDialog: () => null }));

vi.mock('@kit/episodes/server/actions', () => ({
  setStageSkippedAction: vi.fn(),
  importScreenplayAction: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
}));

// Story, screenplay and shot list all exist, unless a test says otherwise
const FULL = {
  id: 'episode-id',
  slug: 'pilot',
  version: 3,
  storyData: {},
  screenplayData: {},
  shotList: {},
  status: 'draft',
  finalVideoUrl: null,
  shots: [],
  skippedStages: [],
};

vi.mock('../episode-context-provider', () => ({
  useEpisodeContext: () => ({
    accountSlug: 'team',
    projectSlug: 'film',
    episode: fixture.episode,
    refetchEpisode: vi.fn(),
  }),
}));

const BASE = '/home/team/studio/film/episodes/pilot';

function tabIds() {
  return screen
    .getAllByTestId(/^episode-tab-/)
    .map((tab) => tab.getAttribute('data-test')?.replace('episode-tab-', ''));
}

/**
 * FILM-607: the Edit Suite is retired. The workspace offers the story tabs,
 * Publish and FILM-2006's read-only Edit record, each linking to its own
 * page, and nothing else. The
 * Playwright spec `apps/e2e/tests/episodes/workspace-tabs.spec.ts` drives
 * the same bar in a browser; this is the deterministic half that the
 * mutation guard runs.
 */
describe('EpisodeWorkspaceTabs (FILM-607)', () => {
  beforeEach(() => {
    navigation.pathname = `${BASE}/ideation`;
    fixture.episode = FULL;
  });

  it('offers the story tabs and Publish, and no Edit Suite', () => {
    render(<EpisodeWorkspaceTabs />);

    expect(tabIds()).toEqual([
      'ideation',
      'story',
      'screenplay',
      'shot-list',
      'audio',
      // FILM-2205: the rail's Video step opens Publish
      'video',
      'publish',
      'edit',
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
      `${BASE}/publish`,
      `${BASE}/edit`,
    ]);
  });

  it('marks the tab for the current page, and only that one', () => {
    navigation.pathname = `${BASE}/publish`;

    render(<EpisodeWorkspaceTabs />);

    expect(
      screen
        .getAllByTestId(/^episode-tab-/)
        .filter((tab) => tab.hasAttribute('aria-current'))
        .map((tab) => [
          tab.getAttribute('data-test'),
          tab.getAttribute('aria-current'),
        ]),
    ).toEqual([['episode-tab-publish', 'step']]);
  });
});

describe('progress rail (FILM-2205)', () => {
  beforeEach(() => {
    fixture.episode = FULL;
  });

  it('locks nothing: a new episode links every stage, and the empty screenplay says what it needs', () => {
    fixture.episode = {
      ...FULL,
      storyData: null,
      screenplayData: null,
      shotList: null,
    };
    navigation.pathname = `${BASE}/screenplay`;

    render(<EpisodeWorkspaceTabs />);

    expect(
      screen
        .getAllByTestId(/^episode-tab-/)
        .every((tab) => tab.tagName === 'A'),
    ).toBe(true);
    expect(
      screen
        .getByTestId('episode-tab-screenplay')
        .getAttribute('data-stage-state'),
    ).toBe('empty');
    expect(screen.getByTestId('stage-banner').textContent).toMatch(
      /No screenplay yet\. Generating it needs a story, or paste a script instead\./,
    );
    expect(screen.getByTestId('stage-banner-skip')).toBeTruthy();
  });

  it('shows a skipped stage as skipped, with Un-skip', () => {
    fixture.episode = {
      ...FULL,
      storyData: null,
      screenplayData: null,
      shotList: null,
      skippedStages: ['story'],
    };
    navigation.pathname = `${BASE}/story`;

    render(<EpisodeWorkspaceTabs />);

    expect(
      screen.getByTestId('episode-tab-story').getAttribute('data-stage-state'),
    ).toBe('skipped');
    expect(screen.getByTestId('stage-banner-unskip')).toBeTruthy();
  });

  it('says nothing under a stage that has output', () => {
    navigation.pathname = `${BASE}/story`;

    render(<EpisodeWorkspaceTabs />);

    expect(screen.queryByTestId('stage-banner')).toBeNull();
  });
});
