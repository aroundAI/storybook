import { Page, expect, test } from '@playwright/test';

import {
  SeededTeam,
  anonRequest,
  insertRow,
  seedProject,
  seedTeamAccount,
  serviceRoleAuth,
  uniqueStamp,
  updateRows,
} from '../utils/seed';

/**
 * KB-88 and KB-85: public share pages for a visitor who is not signed in.
 *
 * Until KB-88 every `/@…` page was a 404 to anyone signed out, because the
 * `anon` role had no USAGE on schema `public`. The fix grants it, after
 * stripping every table privilege `anon` had held behind that one missing
 * grant (KB-85): `anon` now reads three read-only views, and opens unlisted
 * content only through lookups by its exact link.
 *
 * No test here signs in. The browser context has no session at all.
 */

const EVIDENCE = process.env.CAPTURE_EVIDENCE
  ? (process.env.EVIDENCE_DIR ?? 'evidence')
  : null;

async function capture(page: Page, name: string) {
  if (EVIDENCE) {
    await page.screenshot({ path: `${EVIDENCE}/${name}.png`, fullPage: true });
  }
}

const RELEASED = {
  en: { youtube: { url: 'https://www.youtube.com/watch?v=kb88' } },
};

interface PublicFixture {
  team: SeededTeam;
  displayName: string;
  show: { id: string; name: string; slug: string };
  link: { id: string; name: string; slug: string };
  secret: { id: string; name: string; slug: string };
  episodes: {
    pilot: { title: string; slug: string };
    deleted: { title: string; slug: string };
    linkEpisode: { title: string; slug: string };
  };
}

async function seedEpisode(
  projectId: string,
  number: number,
  title: string,
  slug: string,
  extra: Record<string, unknown> = {},
) {
  await insertRow(
    'episodes',
    {
      project_id: projectId,
      number,
      title,
      slug,
      public_slug: slug,
      visibility: 'inherit',
      localized_videos: RELEASED,
      ...extra,
    },
    serviceRoleAuth(),
  );
}

async function seedPublicTeam(): Promise<PublicFixture> {
  const stamp = uniqueStamp().slice(0, 8);
  const team = await seedTeamAccount({ name: `KB88 Studio ${stamp}` });
  const displayName = `KB88 Public Studio ${stamp}`;

  await updateRows('accounts', `id=eq.${team.accountId}`, {
    public_profile: { is_public: true, display_name: displayName },
  });

  const project = async (label: string, visibility: string) => {
    const seeded = await seedProject(team, { name: `KB88 ${label} ${stamp}` });
    const slug = `kb88-${label.toLowerCase()}-${stamp}`;

    await updateRows('projects', `id=eq.${seeded.id}`, {
      visibility,
      public_slug: slug,
    });

    return { id: seeded.id, name: seeded.name, slug };
  };

  const show = await project('Show', 'public');
  const link = await project('Link', 'unlisted');
  const secret = await project('Secret', 'private');

  const episodes = {
    pilot: { title: `KB88 Pilot ${stamp}`, slug: `kb88-pilot-${stamp}` },
    deleted: { title: `KB88 Deleted ${stamp}`, slug: `kb88-deleted-${stamp}` },
    linkEpisode: {
      title: `KB88 Link Episode ${stamp}`,
      slug: `kb88-link-ep-${stamp}`,
    },
  };

  await seedEpisode(show.id, 1, episodes.pilot.title, episodes.pilot.slug);
  await seedEpisode(show.id, 2, episodes.deleted.title, episodes.deleted.slug, {
    deleted_at: new Date().toISOString(),
  });
  await seedEpisode(
    link.id,
    1,
    episodes.linkEpisode.title,
    episodes.linkEpisode.slug,
  );
  await seedEpisode(
    secret.id,
    1,
    `KB88 Secret Episode ${stamp}`,
    `kb88-secret-ep-${stamp}`,
    {
      visibility: 'public',
    },
  );

  return { team, displayName, show, link, secret, episodes };
}

test.describe('Public pages for a visitor who is not signed in (KB-88)', () => {
  test('company, project and episode pages render; unlisted opens by its link only', async ({
    page,
  }) => {
    const f = await seedPublicTeam();
    const base = `/@${f.team.slug}`;

    const company = await page.goto(base);
    expect(company?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { level: 1, name: f.displayName }),
    ).toBeVisible();
    await expect(page.getByText(f.show.name).first()).toBeVisible();
    await expect(page.getByText(f.link.name)).toHaveCount(0);
    await expect(page.getByText(f.secret.name)).toHaveCount(0);
    await capture(page, '01-company-logged-out');

    const show = await page.goto(`${base}/${f.show.slug}`);
    expect(show?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { level: 1, name: f.show.name }),
    ).toBeVisible();
    await expect(page.getByText(f.episodes.pilot.title).first()).toBeVisible();
    await expect(page.getByText(f.episodes.deleted.title)).toHaveCount(0);
    await capture(page, '02-project-logged-out');

    const episode = await page.goto(
      `${base}/${f.show.slug}/e/${f.episodes.pilot.slug}`,
    );
    expect(episode?.status()).toBe(200);
    await expect(
      page.getByRole('heading', { level: 1, name: f.episodes.pilot.title }),
    ).toBeVisible();
    await capture(page, '03-episode-logged-out');

    const link = await page.goto(`${base}/${f.link.slug}`);
    expect(link?.status(), 'an unlisted project opens by its link').toBe(200);
    await expect(
      page.getByRole('heading', { level: 1, name: f.link.name }),
    ).toBeVisible();
    await expect(
      page.getByText(f.episodes.linkEpisode.title).first(),
    ).toBeVisible();
    await capture(page, '04-unlisted-project-by-link');

    const linkEpisode = await page.goto(
      `${base}/${f.link.slug}/e/${f.episodes.linkEpisode.slug}`,
    );
    expect(linkEpisode?.status()).toBe(200);

    const secret = await page.goto(`${base}/${f.secret.slug}`);
    expect(secret?.status(), 'a private project is a 404').toBe(404);
    await capture(page, '05-private-project-404');

    const deleted = await page.goto(
      `${base}/${f.show.slug}/e/${f.episodes.deleted.slug}`,
    );
    expect(deleted?.status(), 'a soft-deleted episode is a 404').toBe(404);
  });

  test('a team that is not public stays a 404', async ({ page }) => {
    const team = await seedTeamAccount();

    const response = await page.goto(`/@${team.slug}`);

    expect(response?.status()).toBe(404);
    await capture(page, '06-private-team-404');
  });

  test('the sitemap lists public pages, and not unlisted, private or deleted ones', async ({
    request,
  }) => {
    const f = await seedPublicTeam();
    const base = `/@${f.team.slug}`;

    const response = await request.get('/sitemap.xml');
    expect(response.status()).toBe(200);

    const xml = await response.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(
      (m) => new URL(m[1]!).pathname,
    );

    expect(locs).toContain(base);
    expect(locs).toContain(`${base}/${f.show.slug}`);
    expect(locs).toContain(`${base}/${f.show.slug}/e/${f.episodes.pilot.slug}`);

    const leaked = locs.filter(
      (path) =>
        path.startsWith(base) &&
        (path.includes(f.link.slug) ||
          path.includes(f.secret.slug) ||
          path.includes(f.episodes.deleted.slug)),
    );
    expect(leaked, 'no unlisted, private or deleted URL').toEqual([]);
  });

  test('the anon API key reads the public views only, and writes nothing', async () => {
    const f = await seedPublicTeam();

    for (const table of ['projects', 'episodes', 'accounts']) {
      const raw = await anonRequest(`/rest/v1/${table}?select=id&limit=1`);
      expect(raw.status, `anon cannot read ${table}`).toBe(401);
    }

    const listed = await anonRequest(
      `/rest/v1/public_projects?select=*&account_id=eq.${f.team.accountId}&order=id`,
    );
    expect(listed.status).toBe(200);
    expect(
      (listed.body as { id: string }[]).map((row) => row.id),
      'only the public project is listed',
    ).toEqual([f.show.id]);
    expect(Object.keys((listed.body as object[])[0]!).sort()).toEqual(
      [
        'account_id',
        'account_slug',
        'created_at',
        'description',
        'id',
        'metadata',
        'name',
        'public_slug',
        'seo_metadata',
        'updated_at',
        'visibility',
      ].sort(),
    );

    const unlisted = await anonRequest(
      `/rest/v1/public_projects?select=id&visibility=eq.unlisted&account_id=eq.${f.team.accountId}`,
    );
    expect(unlisted.body, 'unlisted projects cannot be listed').toEqual([]);

    const byLink = await anonRequest('/rest/v1/rpc/get_shared_project', {
      method: 'POST',
      body: { p_account_id: f.team.accountId, p_public_slug: f.link.slug },
    });
    expect(
      (byLink.body as { id: string }[]).map((row) => row.id),
      'an unlisted project opens by its exact link',
    ).toEqual([f.link.id]);

    const write = await anonRequest(
      `/rest/v1/public_projects?id=eq.${f.show.id}`,
      { method: 'PATCH', body: { name: 'defaced' } },
    );
    expect(
      write.status,
      'anon cannot write through the view',
    ).toBeGreaterThanOrEqual(400);

    const after = await anonRequest(
      `/rest/v1/public_projects?select=name&id=eq.${f.show.id}`,
    );
    expect(after.body).toEqual([{ name: f.show.name }]);

    const insert = await anonRequest('/rest/v1/notifications', {
      method: 'POST',
      body: { account_id: f.team.accountId, body: 'x' },
    });
    expect(insert.status, 'anon cannot write a table').toBe(401);
  });
});
