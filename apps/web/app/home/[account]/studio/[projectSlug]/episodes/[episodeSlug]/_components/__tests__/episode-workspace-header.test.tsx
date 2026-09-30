import { configure, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EpisodeWorkspaceHeader } from '../episode-workspace-header';

configure({ testIdAttribute: 'data-test' });

vi.mock('next/navigation', () => ({
  usePathname: () => '/home/team/studio/film/episodes/pilot/story',
}));

vi.mock('@kit/supabase/hooks/use-supabase', () => ({
  useSupabase: () => ({}),
}));

vi.mock('../episode-context-provider', () => ({
  useEpisodeContext: () => ({
    accountSlug: 'team',
    projectSlug: 'film',
    projectName: 'Film',
    projectId: 'project-id',
    episode: {
      id: 'episode-id',
      title: 'Pilot',
      number: 1,
      version: 1,
      status: 'draft',
      season: null,
      metadata: {},
      storyData: null,
      screenplayData: null,
      description: null,
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  }),
}));

vi.mock('../issue-summary-popover', () => ({ IssueSummaryBadge: () => null }));
vi.mock('../quick-actions-menu', () => ({ QuickActionsMenu: () => null }));
vi.mock('../studio-switcher', () => ({ StudioSwitcher: () => null }));

/**
 * FILM-312: the arrow-only link back to the episode list had no text, so a
 * screen reader announced it as an unnamed link.
 */
describe('EpisodeWorkspaceHeader (FILM-312)', () => {
  it('gives the icon-only back link an accessible name', () => {
    render(<EpisodeWorkspaceHeader />);

    const link = screen.getByRole('link', { name: 'Back to episodes' });

    expect(link.getAttribute('href')).toBe(
      '/home/team/studio/film/episodes',
    );
  });
});
