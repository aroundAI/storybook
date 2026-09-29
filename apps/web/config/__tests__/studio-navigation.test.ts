import { afterEach, describe, expect, it, vi } from 'vitest';

import { getStudioNavigationConfig } from '../studio-navigation.config';

/**
 * FILM-901. The studio sidebar has two shapes: at the studio root it lists
 * projects, inside a project it lists that project's production, assets and
 * analytics. `getStudioNavigationConfig` picks one from its parameters and
 * builds every path from the account slug and project id, so a slug or id
 * mixed up here sends every link to the wrong place.
 */

type Route = {
  label: string;
  children?: Route[];
  path?: string;
  end?: boolean;
};

function pathsOf(routes: Route[]): Route[] {
  return routes.flatMap((route) =>
    route.children ? pathsOf(route.children) : [route],
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('getStudioNavigationConfig', () => {
  it('shows the project list at the studio root', () => {
    const { routes } = getStudioNavigationConfig({ accountSlug: 'acme' });

    expect(pathsOf(routes as Route[]).map((r) => [r.label, r.path])).toEqual([
      ['studio:routes.allProjects', '/home/acme/studio'],
    ]);
  });

  it('shows the project’s own navigation inside a project', () => {
    const { routes } = getStudioNavigationConfig({
      accountSlug: 'acme',
      projectId: 'proj-1',
    });

    expect(pathsOf(routes as Route[]).map((r) => [r.label, r.path])).toEqual([
      ['studio:routes.overview', '/home/acme/studio/proj-1'],
      ['studio:routes.episodes', '/home/acme/studio/proj-1/episodes'],
      [
        'studio:routes.characters',
        '/home/acme/studio/proj-1/assets?tab=character',
      ],
      [
        'studio:routes.locations',
        '/home/acme/studio/proj-1/assets?tab=location',
      ],
      ['studio:routes.voices', '/home/acme/studio/proj-1/assets?tab=voice'],
      ['studio:routes.analytics', '/home/acme/studio/proj-1/analytics'],
    ]);
  });

  it('builds every path from the slug and project id it was given', () => {
    const paths = (slug: string, projectId: string) =>
      pathsOf(
        getStudioNavigationConfig({ accountSlug: slug, projectId })
          .routes as Route[],
      ).map((r) => r.path);

    for (const path of paths('north-team', 'p-9')) {
      expect(path).toMatch(/^\/home\/north-team\/studio\/p-9(\/|\?|$)/);
    }
    expect(paths('north-team', 'p-9')).not.toEqual(paths('south-team', 'p-9'));
    expect(paths('north-team', 'p-9')).not.toEqual(paths('north-team', 'p-8'));
  });

  it('marks the two root links as exact, so nested pages do not light them', () => {
    const exact = (params: { accountSlug: string; projectId?: string }) =>
      pathsOf(getStudioNavigationConfig(params).routes as Route[])
        .filter((r) => r.end)
        .map((r) => r.path);

    expect(exact({ accountSlug: 'acme' })).toEqual(['/home/acme/studio']);
    expect(exact({ accountSlug: 'acme', projectId: 'proj-1' })).toEqual([
      '/home/acme/studio/proj-1',
    ]);
  });

  it('takes the sidebar style and collapse state from the environment when set', () => {
    vi.stubEnv('NEXT_PUBLIC_TEAM_NAVIGATION_STYLE', 'header');
    vi.stubEnv('NEXT_PUBLIC_TEAM_SIDEBAR_COLLAPSED', 'true');

    expect(getStudioNavigationConfig({ accountSlug: 'acme' })).toMatchObject({
      style: 'header',
    });
  });

  it('leaves the style to the schema default when the environment sets none', () => {
    vi.stubEnv('NEXT_PUBLIC_TEAM_NAVIGATION_STYLE', '');

    const config = getStudioNavigationConfig({ accountSlug: 'acme' });

    expect(config.style).toBe('sidebar');
  });
});
