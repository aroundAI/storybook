import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StudioSidebar } from '../app/home/[account]/studio/[projectSlug]/_components/studio-sidebar';
import {
  PENDING_PUBLISH_STATUSES,
  pendingPublishBadge,
} from '../app/home/[account]/studio/[projectSlug]/_lib/pending-publishes';

/**
 * FILM-901. The studio sidebar's Platforms link carries the number of the
 * project's publishes that are waiting to go out or going out now.
 */

vi.mock('next/navigation', () => ({
  usePathname: () => '/home/acme/studio/proj-1',
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('~/components/personal-account-dropdown-container', () => ({
  ProfileAccountDropdownContainer: () => null,
}));

const project = { id: 'p1', name: 'Series', slug: 'proj-1' };
const user = { id: 'u1' } as Parameters<typeof StudioSidebar>[0]['user'];

function renderSidebar(pendingPublishes?: number) {
  const { container } = render(
    <StudioSidebar
      project={project}
      account="acme"
      user={user}
      counts={{ pendingPublishes }}
    />,
  );

  return {
    badge: container.querySelector('[data-test="studio-nav-platforms-badge"]'),
    link: container.querySelector('[data-test="studio-nav-platforms"]'),
  };
}

beforeEach(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('pendingPublishBadge', () => {
  it('has no badge for none, so the link stays bare', () => {
    expect(pendingPublishBadge(0)).toBeNull();
    expect(pendingPublishBadge(undefined)).toBeNull();
    expect(pendingPublishBadge(null)).toBeNull();
  });

  it('shows the count and reads it out', () => {
    expect(pendingPublishBadge(1)).toEqual({
      label: '1',
      ariaLabel: '1 pending publish',
    });
    expect(pendingPublishBadge(7)).toEqual({
      label: '7',
      ariaLabel: '7 pending publishes',
    });
  });

  it('caps the label at 99+ but reads the true count', () => {
    expect(pendingPublishBadge(99)?.label).toBe('99');
    expect(pendingPublishBadge(100)).toEqual({
      label: '99+',
      ariaLabel: '100 pending publishes',
    });
  });

  it('counts the statuses of a publish that has not gone out', () => {
    expect([...PENDING_PUBLISH_STATUSES]).toEqual([
      'draft',
      'scheduled',
      'queued',
      'publishing',
    ]);
  });
});

describe('StudioSidebar pending-publish badge', () => {
  it('shows the count on Platforms and announces it in the link name', () => {
    const { badge, link } = renderSidebar(3);

    expect(badge?.textContent).toBe('3');
    expect(link?.getAttribute('aria-label')).toBe(
      'Platforms, 3 pending publishes',
    );
  });

  it('shows 99+ above ninety-nine', () => {
    const { badge, link } = renderSidebar(250);

    expect(badge?.textContent).toBe('99+');
    expect(link?.getAttribute('aria-label')).toBe(
      'Platforms, 250 pending publishes',
    );
  });

  it('hides the badge when nothing is pending', () => {
    const { badge, link } = renderSidebar(0);

    expect(badge).toBeNull();
    expect(link?.getAttribute('aria-label')).toBeNull();
  });
});
