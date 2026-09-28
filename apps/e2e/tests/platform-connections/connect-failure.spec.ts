import { Page, expect, test } from '@playwright/test';

import {
  SeededTeam,
  seedMembership,
  seedTeamAccount,
  seedUser,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * KB-19. A refused, cancelled or broken platform connect used to end on the
 * app's 404 page with the reason only in the address bar.
 *
 * Every test here drives a real OAuth callback route the way a vendor's
 * redirect would, and reads the message off the page a person lands on. The
 * vendor's half of the round trip is not needed: the failure branches all run
 * before the callback talks to the vendor.
 */
const PLATFORMS = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'tiktok', label: 'TikTok' },
  { id: 'meta', label: 'Meta (Facebook and Instagram)' },
  { id: 'twitter', label: 'X (Twitter)' },
  { id: 'linkedin', label: 'LinkedIn' },
] as const;

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

/** What a connect route puts in `state`; the nonce here matches no stored row. */
function stateFor(team: SeededTeam, extra: Record<string, unknown> = {}) {
  return Buffer.from(
    JSON.stringify({
      accountId: team.accountId,
      returnUrl: `/home/${team.slug}/settings/platforms`,
      nonce: '00000000-0000-4000-8000-000000000000',
      ...extra,
    }),
  ).toString('base64url');
}

function callback(platform: string, params: Record<string, string>) {
  return `/api/platforms/callback/${platform}?${new URLSearchParams(params)}`;
}

function failure(page: Page) {
  return byTest(page, 'connect-failure');
}

/** PR screenshots, only when asked for: CI pays nothing for them. */
async function captureIfAsked(page: Page, name: string) {
  if (process.env.CAPTURE_EVIDENCE) {
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });
  }
}

async function signedInTeam(page: Page) {
  const team = await seedTeamAccount({ emailPrefix: 'kb19' });

  await signInAs(page, team);

  return team;
}

function expectOnPlatformsPage(page: Page, team: SeededTeam) {
  const url = new URL(page.url());
  const base = new URL(test.info().project.use.baseURL ?? page.url());

  expect(url.origin).toBe(base.origin);
  expect(url.pathname).toBe(`/home/${team.slug}/settings/platforms`);
}

for (const platform of PLATFORMS) {
  test.describe(`A failed ${platform.label} connect`, () => {
    test('a declined consent screen lands on the platforms page and says so', async ({
      page,
    }) => {
      const team = await signedInTeam(page);

      await page.goto(
        callback(platform.id, {
          error: 'access_denied',
          error_description: 'The user denied the request',
          state: stateFor(team),
        }),
      );

      await expect(failure(page)).toBeVisible();
      expectOnPlatformsPage(page, team);

      await expect(failure(page)).toHaveAttribute('data-code', 'access_denied');
      await expect(failure(page)).toHaveAttribute('data-platform', platform.id);
      await expect(
        failure(page).locator('[data-test="connect-failure-title"]'),
      ).toHaveText(`${platform.label} was not connected`);
      await expect(
        failure(page).locator('[data-test="connect-failure-message"]'),
      ).toContainText(
        `${platform.label} reported that access was denied. That is what it sends when the consent screen is cancelled or declined`,
      );
      await expect(
        failure(page).locator('[data-test="connect-failure-vendor"]'),
      ).toContainText('The user denied the request');
    });

    test('a refused permission says the review may not be approved yet', async ({
      page,
    }) => {
      const team = await signedInTeam(page);

      await page.goto(
        callback(platform.id, {
          error: 'invalid_scope',
          error_description: 'Scope not authorized for this client',
          log_id: '20260922KB19',
          state: stateFor(team),
        }),
      );

      await expect(failure(page)).toBeVisible();
      expectOnPlatformsPage(page, team);

      await expect(failure(page)).toHaveAttribute('data-code', 'invalid_scope');
      await expect(
        failure(page).locator('[data-test="connect-failure-message"]'),
      ).toContainText(
        `${platform.label} refused a permission this app asked for. The app’s review for that permission may not be approved yet`,
      );
      await expect(
        failure(page).locator('[data-test="connect-failure-vendor"]'),
      ).toContainText('Scope not authorized for this client');
      // The reference a vendor's support asks for, where one is sent.
      await expect(
        failure(page).locator('[data-test="connect-failure-vendor-log-id"]'),
      ).toHaveText('20260922KB19');
    });

    test('a state that cannot be read still lands on a real page', async ({
      page,
    }) => {
      const team = await signedInTeam(page);

      await page.goto(
        callback(platform.id, {
          code: 'not-a-real-code',
          state: '%%garbage%%',
        }),
      );

      await expect(failure(page)).toBeVisible();
      // No account in the state: the landing falls back to the one team
      // this person belongs to.
      expectOnPlatformsPage(page, team);

      await expect(failure(page)).toHaveAttribute('data-code', 'invalid_state');
      await expect(
        failure(page).locator('[data-test="connect-failure-message"]'),
      ).toContainText(
        'The request that came back could not be matched to a connection this app started',
      );
      // The authorisation code never travels to the page.
      expect(page.url()).not.toContain('not-a-real-code');
    });
  });
}

test.describe('A failed connect — the branches that share one helper', () => {
  test('a state that matches no stored attempt reads as expired', async ({
    page,
  }) => {
    const team = await signedInTeam(page);

    await page.goto(
      callback('youtube', { code: 'not-a-real-code', state: stateFor(team) }),
    );

    await expect(failure(page)).toHaveAttribute('data-code', 'state_expired');
    expectOnPlatformsPage(page, team);
    await expect(
      failure(page).locator('[data-test="connect-failure-message"]'),
    ).toContainText('This connection attempt expired or was already used');
  });

  test('a state that is valid JSON but not a state is refused, not a 500', async ({
    page,
  }) => {
    const team = await signedInTeam(page);

    await page.goto(
      callback('meta', {
        code: 'not-a-real-code',
        state: Buffer.from('null').toString('base64url'),
      }),
    );

    await expect(failure(page)).toHaveAttribute('data-code', 'invalid_state');
    expectOnPlatformsPage(page, team);
  });

  test('a channel choice with nothing pending says so', async ({ page }) => {
    const team = await signedInTeam(page);

    await page.goto(
      `/home/${team.slug}/settings/platforms/youtube/select-channel`,
    );

    await expect(failure(page)).toHaveAttribute(
      'data-code',
      'pending_connection_lost',
    );
    expectOnPlatformsPage(page, team);
    await expect(
      failure(page).locator('[data-test="connect-failure-message"]'),
    ).toContainText('the pending YouTube connection was not found');
  });

  test('a callback with nothing on it says so', async ({ page }) => {
    const team = await signedInTeam(page);

    await page.goto('/api/platforms/callback/tiktok');

    await expect(failure(page)).toHaveAttribute('data-code', 'missing_params');
    expectOnPlatformsPage(page, team);
    await expect(
      failure(page).locator('[data-test="connect-failure-message"]'),
    ).toContainText('TikTok sent you back without an authorisation code');
  });

  // KB-99: `/home` redirects to a team and drops the query, so a failure no
  // workspace can be chosen for lands on a page that renders it instead.
  test('someone with no team lands on create-team, with the message', async ({
    page,
  }) => {
    const user = await seedUser('kb19-solo');

    await signInAs(page, user);
    await page.goto(callback('linkedin', { error: 'access_denied' }));

    await expect(failure(page)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/home/teams/create');
    await expect(
      failure(page).locator('[data-test="connect-failure-title"]'),
    ).toHaveText('LinkedIn was not connected');
    // The create-team dialog waits: opened over the message, it hides it.
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await captureIfAsked(page, 'kb99-01-no-team');

    await failure(page)
      .locator('[data-test="connect-failure-dismiss"]')
      .click();
    await expect(failure(page)).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/home/teams/create');
    expect(new URL(page.url()).search).toBe('');
  });

  test('someone in several teams, with no hint which, sees it on their profile page', async ({
    page,
  }) => {
    const team = await seedTeamAccount({ emailPrefix: 'kb99-two' });
    const other = await seedTeamAccount({ emailPrefix: 'kb99-other' });
    await seedMembership(team.userId, other.accountId);

    await signInAs(page, team);
    await page.goto(callback('linkedin', { error: 'access_denied' }));

    await expect(failure(page)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/home/settings');
    await expect(
      failure(page).locator('[data-test="connect-failure-title"]'),
    ).toHaveText('LinkedIn was not connected');
    await captureIfAsked(page, 'kb99-02-several-teams');

    await failure(page)
      .locator('[data-test="connect-failure-dismiss"]')
      .click();
    await expect(failure(page)).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe('/home/settings');
    expect(new URL(page.url()).search).toBe('');
  });

  test('dismissing the message clears it from the address, and it stays gone', async ({
    page,
  }) => {
    const team = await signedInTeam(page);

    await page.goto(
      callback('youtube', { error: 'access_denied', state: stateFor(team) }),
    );
    await expect(failure(page)).toBeVisible();

    // A refresh before dismissing keeps it: the address still says it failed.
    await page.reload();
    await expect(failure(page)).toBeVisible();

    await failure(page)
      .locator('[data-test="connect-failure-dismiss"]')
      .click();

    await expect(failure(page)).toHaveCount(0);
    await expect(page).toHaveURL(
      new RegExp(`/home/${team.slug}/settings/platforms$`),
    );

    await page.reload();
    await expect(failure(page)).toHaveCount(0);
    await expect(byTest(page, 'platform-connections')).toBeVisible();
  });
});

test.describe('A failed connect — hostile input', () => {
  test('markup in the vendor’s description is shown as text and never runs', async ({
    page,
  }) => {
    const team = await signedInTeam(page);
    const hostile =
      '<script>window.__kb19 = "ran"</script><img src=x onerror="window.__kb19=\'ran\'">';

    await page.goto(
      callback('meta', {
        error: 'access_denied',
        error_description: hostile,
        state: stateFor(team),
      }),
    );

    await expect(failure(page)).toBeVisible();

    const vendor = failure(page).locator(
      '[data-test="connect-failure-vendor"]',
    );

    await expect(vendor).toContainText(
      '<script>window.__kb19 = "ran"</script>',
    );
    await expect(failure(page).locator('script, img')).toHaveCount(0);
    expect(
      await page.evaluate(
        () => (window as unknown as { __kb19?: string }).__kb19,
      ),
    ).toBeUndefined();
  });

  test('a 5,000-character description is cut short, in the address and on the page', async ({
    page,
  }) => {
    const team = await signedInTeam(page);

    await page.goto(
      callback('tiktok', {
        error: 'invalid_scope',
        error_description: 'A'.repeat(5000),
        state: stateFor(team),
      }),
    );

    await expect(failure(page)).toBeVisible();

    const shown = await failure(page)
      .locator('[data-test="connect-failure-vendor-text"]')
      .innerText();

    expect(shown.length).toBeLessThanOrEqual(301);
    expect(shown.endsWith('…')).toBe(true);
    expect(page.url().length).toBeLessThan(1000);
  });

  test('a vendor description is not shown for a failure no vendor reported', async ({
    page,
  }) => {
    const team = await signedInTeam(page);

    // A crafted link: our own code, with text dressed up as the vendor's.
    await page.goto(
      `/settings/platforms?error=state_expired&platform=youtube&vendor_message=${encodeURIComponent('Call 555-0100 to restore your account')}`,
    );

    await expect(failure(page)).toHaveAttribute('data-code', 'state_expired');
    expectOnPlatformsPage(page, team);
    await expect(failure(page)).not.toContainText('555-0100');
  });

  test('an unknown code and platform get the generic message, not the raw value', async ({
    page,
  }) => {
    const team = await signedInTeam(page);

    await page.goto(
      `/home/${team.slug}/settings/platforms?error=${encodeURIComponent('<b>pwned</b>')}&platform=${encodeURIComponent('evil.example')}`,
    );

    await expect(failure(page)).toHaveAttribute('data-code', 'unknown');
    await expect(
      failure(page).locator('[data-test="connect-failure-title"]'),
    ).toHaveText('the platform was not connected', { ignoreCase: true });
    await expect(failure(page)).not.toContainText('pwned');
    await expect(failure(page)).not.toContainText('evil.example');
  });
});

test.describe('A failed connect — the redirect cannot be steered off-site', () => {
  const ATTEMPTS = [
    {
      name: 'an absolute URL as the account in state',
      url: (team: SeededTeam) =>
        callback('youtube', {
          error: 'access_denied',
          state: stateFor(team, {
            accountId: 'https://evil.example/',
            returnUrl: 'https://evil.example/',
          }),
        }),
    },
    {
      name: 'a protocol-relative account on the landing',
      url: () =>
        '/settings/platforms?error=access_denied&platform=youtube&account=//evil.example/%2F..',
    },
    {
      name: 'a path traversal as the account on the landing',
      url: () =>
        '/settings/platforms?error=access_denied&platform=youtube&account=..%2F..%2Fauth%2Fsign-out',
    },
    {
      name: 'a returnUrl and next parameter on the callback',
      url: () =>
        callback('twitter', {
          error: 'access_denied',
          returnUrl: 'https://evil.example/',
          next: 'https://evil.example/',
          redirect: '//evil.example',
        }),
    },
  ];

  for (const attempt of ATTEMPTS) {
    test(attempt.name, async ({ page }) => {
      const team = await signedInTeam(page);

      await page.goto(attempt.url(team));

      await expect(failure(page)).toBeVisible();
      expectOnPlatformsPage(page, team);
      expect(page.url()).not.toContain('evil.example');
    });
  }
});

test.describe('A failed connect — evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 to regenerate the PR screenshots.',
  );

  test('captures what a person sees for each kind of failure', async ({
    page,
  }) => {
    const team = await signedInTeam(page);
    const measured: Array<Record<string, string | null>> = [];

    const capture = async (name: string, url: string) => {
      await page.goto(url);
      await expect(failure(page)).toBeVisible();
      await page.screenshot({ path: `${OUT}/${name}.png` });

      measured.push({
        shot: name,
        path: new URL(page.url()).pathname,
        code: await failure(page).getAttribute('data-code'),
        platform: await failure(page).getAttribute('data-platform'),
        title: await failure(page)
          .locator('[data-test="connect-failure-title"]')
          .innerText(),
        message: await failure(page)
          .locator('[data-test="connect-failure-message"]')
          .innerText(),
        action: await failure(page)
          .locator('[data-test="connect-failure-action"]')
          .innerText(),
      });
    };

    await capture(
      '01-access-denied',
      callback('youtube', {
        error: 'access_denied',
        error_description: 'The user denied the request',
        state: stateFor(team),
      }),
    );
    await capture(
      '02-scope-refused',
      callback('tiktok', {
        error: 'invalid_scope',
        error_description: 'Scope video.list is not authorized for this client',
        log_id: '20260922KB19',
        state: stateFor(team),
      }),
    );
    await capture(
      '03-bad-state',
      callback('meta', { code: 'not-a-real-code', state: '%%garbage%%' }),
    );
    await capture(
      '04-hostile-description',
      callback('twitter', {
        error: 'access_denied',
        error_description: `<script>alert(1)</script> ${'A'.repeat(5000)}`,
        state: stateFor(team),
      }),
    );

    await failure(page)
      .locator('[data-test="connect-failure-dismiss"]')
      .click();
    await expect(failure(page)).toHaveCount(0);
    await page.screenshot({ path: `${OUT}/05-after-dismiss.png` });

    measured.push({
      shot: '05-after-dismiss',
      path: new URL(page.url()).pathname,
      code: null,
      platform: null,
      title: null,
      message: null,
      action: `search: "${new URL(page.url()).search}"`,
    });

    console.log(JSON.stringify(measured, null, 2));
  });
});
