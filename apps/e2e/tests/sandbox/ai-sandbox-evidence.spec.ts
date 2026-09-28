import { expect, test } from '@playwright/test';

import { seedProject, seedTeamAccount } from '../utils/seed';
import { signInAs } from '../utils/session';

/**
 * FILM-1803: the inline AI flows, driven in a real app against the AI
 * sandbox, with every figure read off the page and compared with what the
 * sandbox's ledger says it served.
 *
 * Needs an app server started with local.env's sandbox block and the
 * sandbox itself running (`./scripts/local-env.sh up`). Skipped otherwise,
 * and so in CI:
 *
 *   AI_SANDBOX_EVIDENCE=1 CAPTURE_EVIDENCE=1 EVIDENCE_DIR=/tmp/evidence \
 *     PLAYWRIGHT_BASE_URL=http://localhost:3144 npx playwright test ai-sandbox-evidence
 */

const CONTROL = process.env.SANDBOX_CONTROL_URL ?? 'http://127.0.0.1:4100';
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const shoot = Boolean(process.env.CAPTURE_EVIDENCE);

interface LedgerEntry {
  id: number;
  vendor: string;
  method: string;
  path: string;
  status: number;
  responseSummary?: string;
}

async function ledger(vendor: string, since = 0) {
  const response = await fetch(
    `${CONTROL}/__sandbox/ledger?vendor=${vendor}&since=${since}`,
  );
  return ((await response.json()) as { entries: LedgerEntry[] }).entries;
}

async function lastId() {
  const response = await fetch(`${CONTROL}/__sandbox/ledger`);
  return (
    ((await response.json()) as { entries: LedgerEntry[] }).entries[0]?.id ?? 0
  );
}

test.describe('AI sandbox — inline flows (FILM-1803)', () => {
  test.skip(
    !process.env.AI_SANDBOX_EVIDENCE,
    'Set AI_SANDBOX_EVIDENCE=1, with the sandbox and a sandbox-configured app running.',
  );

  test('an ElevenLabs key is checked, saved, and used for a sound effect; music hits the undocumented path', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const team = await seedTeamAccount({ emailPrefix: 'ai-sandbox' });
    const project = await seedProject(team, {
      name: 'Harbor Lights Diner',
      slug: `harbor-lights-${Date.now()}`,
    });
    await signInAs(page, team);

    // --- Settings: the key check goes to the sandbox, not to ElevenLabs.
    await page.goto(`/home/${team.slug}/settings`);
    const card = page
      .locator('div')
      .filter({ has: page.getByText('ElevenLabs', { exact: true }) })
      .filter({ has: page.getByRole('button', { name: /Add Key|Update/ }) })
      .last();
    await card.getByRole('button', { name: /Add Key|Update/ }).click();

    const dialog = page.getByRole('dialog');
    const keyInput = dialog.locator('#api-key');

    let since = await lastId();
    await keyInput.fill('sandbox-invalid-key');
    await dialog.getByRole('button', { name: 'Test' }).click();
    await expect
      .poll(async () =>
        (await ledger('elevenlabs', since)).map((e) => `${e.path} ${e.status}`),
      )
      .toContain('/v1/user 401');
    if (shoot) await dialog.screenshot({ path: `${OUT}/01-key-refused.png` });

    since = await lastId();
    await keyInput.fill('sandbox-local-key');
    await dialog.getByRole('button', { name: 'Test' }).click();
    await expect
      .poll(async () =>
        (await ledger('elevenlabs', since)).map((e) => `${e.path} ${e.status}`),
      )
      .toContain('/v1/user 200');
    if (shoot) await dialog.screenshot({ path: `${OUT}/02-key-accepted.png` });

    await dialog.getByRole('button', { name: 'Save Key' }).click();
    await expect(page.getByText('API key saved successfully')).toBeVisible();
    await expect(card.getByText('Connected')).toBeVisible();
    if (shoot) await card.screenshot({ path: `${OUT}/03-key-saved.png` });

    // --- Audio library: a sound effect from the sandbox, played by the browser.
    await page.goto(`/home/${team.slug}/studio/${project.slug}/audio-library`);
    await page
      .getByRole('button', { name: /Generate/ })
      .first()
      .click();
    const generate = page.getByRole('dialog');
    await generate.getByRole('tab', { name: /Sound|SFX/i }).click();
    await generate.locator('#name').fill('Ferry horn at dusk');
    await generate
      .locator('#prompt')
      .fill('A ferry horn far across the water, gulls overhead');
    const durationInput = generate.locator('input[type="number"]');
    await durationInput.fill('8');

    since = await lastId();
    await generate
      .getByRole('button', { name: /^Generate/ })
      .last()
      .click();

    const asset = page
      .locator('[data-test="audio-asset-card"]')
      .filter({ hasText: 'Ferry horn at dusk', visible: true }); // KB-136
    await expect(asset).toBeVisible({ timeout: 60_000 });
    const served = (await ledger('elevenlabs', since)).find(
      (e) => e.path === '/v1/sound-generation',
    );
    expect(served?.status).toBe(200);

    // The browser's own measurement of the file the sandbox served.
    const measured = await asset.locator('audio').evaluate(
      (audio: HTMLAudioElement) =>
        new Promise<number>((resolve) => {
          if (audio.readyState >= 1) resolve(audio.duration);
          else
            audio.addEventListener(
              'loadedmetadata',
              () => resolve(audio.duration),
              { once: true },
            );
          audio.load();
        }),
    );
    expect(Math.abs(measured - 8)).toBeLessThan(0.3);
    test.info().annotations.push({
      type: 'sfx',
      description: `served ${served?.responseSummary}; browser measured ${measured.toFixed(2)} s`,
    });
    if (shoot) await asset.screenshot({ path: `${OUT}/04-sound-effect.png` });

    // --- Music: the app's provider calls /v1/music/compose, which ElevenLabs
    // does not document; the sandbox answers it with the vendor's 404.
    await page
      .getByRole('button', { name: /Generate/ })
      .first()
      .click();
    const music = page.getByRole('dialog');
    await music.getByRole('tab', { name: /Music/i }).click();
    await music.locator('#name').fill('Harbor theme');
    await music
      .locator('#prompt')
      .fill('Warm acoustic theme for a seaside mystery');
    since = await lastId();
    await music
      .getByRole('button', { name: /^Generate/ })
      .last()
      .click();
    await expect
      .poll(async () =>
        (await ledger('elevenlabs', since)).map((e) => `${e.path} ${e.status}`),
      )
      .toContain('/v1/music/compose 404');
    await expect(page.getByText(/404|failed/i).first()).toBeVisible({
      timeout: 30_000,
    });
    if (shoot)
      await page.screenshot({ path: `${OUT}/05-music-undocumented-path.png` });

    // --- The sandbox's own view of the session.
    if (shoot) {
      await page.goto(`${CONTROL}/__sandbox`);
      await page.screenshot({
        path: `${OUT}/06-sandbox-status.png`,
        fullPage: true,
      });
    }
  });
});
