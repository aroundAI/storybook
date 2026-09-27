import { Page, expect, test } from '@playwright/test';

import {
  insertRow,
  seedProject,
  seedTeamAccount,
  seedUser,
  serviceRoleAuth,
  uniqueStamp,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * Structured data on the public pages is `JSON.stringify` inside
 * `<script type="application/ld+json">`. JSON does not escape `<`, so a
 * title containing `</script>` closes the script element early and whatever
 * follows is parsed as HTML — a second, executable `<script>` included. The
 * titles are the team's, the project's and the episode's: written by any
 * signed-in user, and read by every visitor to the public page.
 *
 * The page must run none of it, and the structured data must still say
 * exactly what the creator typed.
 */
const MARK = '__jsonLdEscape';

function payload(label: string) {
  return `${label} </script><script>window.${MARK}=(window.${MARK}||[]).concat('${label}')</script> <!-- & \u2028`;
}

async function ranInjectedScript(page: Page) {
  return page.evaluate(
    (mark) => (window as unknown as Record<string, unknown>)[mark] ?? null,
    MARK,
  );
}

async function structuredNames(page: Page) {
  return page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((scripts) =>
      scripts.map((script) => {
        try {
          return (JSON.parse(script.textContent ?? '') as { name?: string })
            .name;
        } catch {
          return 'UNPARSEABLE';
        }
      }),
    );
}

test.describe('Public page structured data cannot break out of its script', () => {
  test('a title with </script> in it runs nothing and survives intact', async ({
    page,
  }) => {
    const stamp = uniqueStamp().slice(0, 8);
    const teamName = payload(`Team ${stamp}`);
    const team = await seedTeamAccount({ name: teamName });

    await updateRows('accounts', `id=eq.${team.accountId}`, {
      public_profile: { is_public: true },
    });

    const projectName = payload(`Show ${stamp}`);
    const project = await seedProject(team, { name: projectName });
    const projectSlug = `jsonld-show-${stamp}`;

    await updateRows('projects', `id=eq.${project.id}`, {
      visibility: 'public',
      public_slug: projectSlug,
    });

    const episodeTitle = payload(`Pilot ${stamp}`);
    const episodeSlug = `jsonld-pilot-${stamp}`;

    await insertRow(
      'episodes',
      {
        project_id: project.id,
        number: 1,
        title: episodeTitle,
        slug: episodeSlug,
        public_slug: episodeSlug,
        visibility: 'inherit',
      },
      serviceRoleAuth(),
    );

    await signInAs(page, await seedUser('jsonld-visitor'));

    for (const [path, name] of [
      [`/@${team.slug}`, teamName],
      [`/@${team.slug}/${projectSlug}`, projectName],
      [`/@${team.slug}/${projectSlug}/e/${episodeSlug}`, episodeTitle],
    ] as const) {
      const response = await page.goto(path);

      expect(response?.status(), path).toBe(200);
      expect(await ranInjectedScript(page), path).toBeNull();
      expect(await structuredNames(page), path).toContain(name);
    }
  });
});
