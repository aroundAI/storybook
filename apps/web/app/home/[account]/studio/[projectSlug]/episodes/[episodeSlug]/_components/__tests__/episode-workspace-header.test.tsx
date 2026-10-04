import { configure, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { editingInStudioOf } from '../editing-in-studio-badge';
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

    expect(link.getAttribute('href')).toBe('/home/team/studio/film/episodes');
  });
});

/**
 * FILM-2002: the "Editing in Studio" chip shows while a session is open and
 * names the editor; editingInStudioOf derives it from status and edit_state.
 */
describe('EpisodeWorkspaceHeader editing badge (FILM-2002)', () => {
  const since = '2026-10-04T10:00:00.000Z';

  it('shows the editor when a Studio session is open', () => {
    render(
      <EpisodeWorkspaceHeader
        editingInStudio={{ editorName: 'Maya', since }}
      />,
    );

    expect(screen.getByTestId('editing-in-studio-badge').textContent).toMatch(
      /Editing in Studio by Maya since/,
    );
  });

  it('shows nothing without an open session', () => {
    render(<EpisodeWorkspaceHeader editingInStudio={null} />);

    expect(screen.queryByTestId('editing-in-studio-badge')).toBeNull();
  });
});

describe('editingInStudioOf (FILM-2002)', () => {
  const editState = {
    sessionId: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff',
    editedBy: { userId: '6f9619ff-8b86-4d01-b42d-00cf4fc964ff', name: 'Maya' },
    since: '2026-10-04T10:00:00.000Z',
    lastDeliveredAt: null,
    editedIn: 'studio',
    versions: 0,
  };

  it('reads the editor and start time while editing', () => {
    expect(
      editingInStudioOf({ status: 'editing', edit_state: editState }),
    ).toEqual({
      editorName: 'Maya',
      since: editState.since,
    });
  });

  it('is null once the status has moved on or no session is named', () => {
    expect(
      editingInStudioOf({ status: 'ready', edit_state: editState }),
    ).toBeNull();
    expect(editingInStudioOf({ status: 'editing', edit_state: {} })).toBeNull();
  });
});
