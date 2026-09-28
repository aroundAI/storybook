import { type Page, expect, test } from '@playwright/test';

import {
  insertRow,
  readRows,
  seedProject,
  seedTeamAccount,
  serviceRoleAuth,
  updateRows,
} from '../utils/seed';
import { signInAs } from '../utils/session';
import { byTest } from '../utils/visible';

/**
 * FILM-1806 (and FILM-1803's browser-driven criterion): one full studio run
 * in a real app - ideation → story → screenplay → shots → dialogue voice -
 * with every stage enqueued to the local job queue, run by the app's own
 * llm-worker and voice-worker, answered by the AI sandbox, and delivered back
 * to the page over the local WebSocket gateway. What the page shows is read
 * off it and compared with what the sandbox's ledger says it served.
 *
 * Needs `./scripts/local-env.sh up` (sandbox + local job queue) and an app
 * server started with local.env. Skipped otherwise, and so in CI:
 *
 *   STUDIO_FLOW_EVIDENCE=1 CAPTURE_EVIDENCE=1 EVIDENCE_DIR=/tmp/studio \
 *     PLAYWRIGHT_BASE_URL=http://localhost:3144 npx playwright test studio-flow-evidence
 */

const CONTROL = process.env.SANDBOX_CONTROL_URL ?? 'http://127.0.0.1:4100';
const ELEVENLABS =
  process.env.SANDBOX_ELEVENLABS_URL ?? 'http://127.0.0.1:4113';
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const shoot = Boolean(process.env.CAPTURE_EVIDENCE);

interface LedgerEntry {
  id: number;
  vendor: string;
  path: string;
  status: number;
  identified?: { kind: string; key?: string };
  responseSummary?: string;
}

async function ledger() {
  const response = await fetch(`${CONTROL}/__sandbox/ledger`);
  return ((await response.json()) as { entries: LedgerEntry[] }).entries;
}

async function snap(page: Page, name: string) {
  if (shoot)
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
}

const STAGE_TIMEOUT = 120_000;

test.describe('A full studio run through the local job queue (FILM-1806)', () => {
  test.skip(
    !process.env.STUDIO_FLOW_EVIDENCE,
    'Set STUDIO_FLOW_EVIDENCE=1, with the sandbox, the local job queue and a local.env app running.',
  );

  test.use({ actionTimeout: 30_000 });

  test('ideation → story → screenplay → shots → voice', async ({ page }) => {
    test.setTimeout(900_000);

    // --- Seed: a team, a show, two characters with voices, two places, an episode.
    const team = await seedTeamAccount({ emailPrefix: 'studio-flow' });
    const project = await seedProject(team, {
      name: 'Harbor Lights Diner',
      slug: `harbor-lights-${Date.now()}`,
    });
    const auth = serviceRoleAuth();
    // Voice needs the project's TTS model, set in Project Settings; there is
    // no default (getProjectTTSModel refuses without one).
    await updateRows('projects', `id=eq.${project.id}`, {
      audio_settings: { elevenlabs: { tts_model: 'eleven_multilingual_v2' } },
    });

    const voices = (
      (await (
        await fetch(`${ELEVENLABS}/v1/voices`, {
          headers: { 'xi-api-key': 'sandbox-local-key' },
        })
      ).json()) as {
        voices: Array<{ voice_id: string; name: string }>;
      }
    ).voices;

    const characterIds: string[] = [];
    for (const [i, [name, role, description]] of [
      [
        'Mara Okafor',
        'protagonist',
        "The lighthouse keeper's granddaughter: curious, stubborn, twelve years old",
      ],
      [
        'Theo Lindqvist',
        'supporting',
        'A night-shift baker who knows every rumour in town',
      ],
    ].entries()) {
      const asset = await insertRow<{ id: string }>(
        'assets',
        { project_id: project.id, type: 'character', name, description },
        auth,
      );
      await insertRow(
        'character_details',
        { asset_id: asset.id, role, elevenlabs_voice_id: voices[i]!.voice_id },
        auth,
      );
      characterIds.push(asset.id);
    }

    const locationIds: string[] = [];
    for (const [name, description] of [
      [
        'The lighthouse on Gull Point',
        'A white stone lighthouse at the end of a shingle spit',
      ],
      [
        "Mrs. Varga's bakery on Canal Road",
        'A narrow bakery that opens at four in the morning',
      ],
    ]) {
      const asset = await insertRow<{ id: string }>(
        'assets',
        { project_id: project.id, type: 'location', name, description },
        auth,
      );
      locationIds.push(asset.id);
    }

    const episodeSlug = `the-letter-${Date.now()}`;
    const episode = await insertRow<{ id: string }>(
      'episodes',
      {
        project_id: project.id,
        number: 1,
        title: 'The Letter Under the Floorboards',
        slug: episodeSlug,
        metadata: { character_ids: characterIds, location_ids: locationIds },
      },
      auth,
    );

    await signInAs(page, team);

    // --- The account's ElevenLabs key, which the voice worker decrypts.
    await page.goto(`/home/${team.slug}/settings`);
    const card = page
      .locator('div')
      .filter({ has: page.getByText('ElevenLabs', { exact: true }) })
      .filter({ has: page.getByRole('button', { name: /Add Key|Update/ }) })
      .last();
    await card.getByRole('button', { name: /Add Key|Update/ }).click();
    await page
      .getByRole('dialog')
      .locator('#api-key')
      .fill('sandbox-local-key');
    // Checked against the ElevenLabs stand-in before it can be saved.
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Test' })
      .click();
    await expect(
      page.getByRole('dialog').getByRole('button', { name: 'Save Key' }),
    ).toBeEnabled();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Save Key' })
      .click();
    await expect(page.getByText('API key saved successfully')).toBeVisible();

    const episodeUrl = `/home/${team.slug}/studio/${project.slug}/episodes/${episodeSlug}`;

    // --- 1. Ideation (enqueued: story-ideation → ideation orchestrator).
    await page.goto(`${episodeUrl}/ideation`, { timeout: STAGE_TIMEOUT }); // a first dev compile is slow
    await page
      .locator('[data-test="ideation-premise"]')
      .fill(
        'Mara finds a sealed letter under the lighthouse floorboards, addressed to someone who has not been born yet.',
      );
    // The sandbox's ledger outlives a run: read only what this run asked for.
    const ledgerStart = (await ledger())[0]?.id ?? 0;
    await byTest(page, 'ideation-generate').click();
    await expect(page.getByText(/Generated \d+ story ideas/)).toBeVisible({
      timeout: STAGE_TIMEOUT,
    });

    const ideationReplies = (await ledger()).filter(
      (e) => e.id > ledgerStart && e.identified?.key === 'story-ideation',
    );
    expect(ideationReplies.length).toBeGreaterThan(0);
    const servedTitles = ideationReplies.flatMap((reply) =>
      [...(reply.responseSummary ?? '').matchAll(/"title": "([^"]+)"/g)].map(
        (m) => m[1]!,
      ),
    );
    await expect(
      page.getByText(servedTitles[0]!, { exact: true }).first(),
    ).toBeVisible();
    await snap(page, '01-ideation-ideas');

    // --- 2. Story (enqueued: story-generation → story orchestrator).
    await page.getByText(servedTitles[0]!, { exact: true }).first().click();
    await expect(page.getByText('Refine Your Story')).toBeVisible();
    await snap(page, '02-refine-idea');
    await page.getByRole('button', { name: 'Generate Story' }).click();
    await expect(page).toHaveURL(/\/story$/, { timeout: STAGE_TIMEOUT });
    await expect(
      page.getByRole('button', { name: 'Convert to Screenplay' }),
    ).toBeVisible({ timeout: STAGE_TIMEOUT });
    await snap(page, '03-story');

    // --- 3. Screenplay (enqueued: screenplay-conversion → screenplay orchestrator).
    await page.getByRole('button', { name: 'Convert to Screenplay' }).click();
    await expect(page).toHaveURL(/\/screenplay$/, { timeout: STAGE_TIMEOUT });
    await expect(
      page.getByRole('button', { name: /Approve & Generate Shots/ }),
    ).toBeEnabled({ timeout: STAGE_TIMEOUT });
    await expect(page.getByText(/Mara Okafor|MARA OKAFOR/).first()).toBeVisible(
      { timeout: STAGE_TIMEOUT },
    );
    await snap(page, '04-screenplay');

    // --- 4. Shots (enqueued: shot-generation → shot orchestrator).
    await page
      .getByRole('button', { name: /Approve & Generate Shots/ })
      .click();
    await expect(page.getByText(/Shot list generated/).first()).toBeVisible({
      timeout: STAGE_TIMEOUT,
    });
    await page.goto(`${episodeUrl}/visual-studio`, { timeout: STAGE_TIMEOUT }); // a first dev compile is slow
    await expect(page.getByText(/^\d+ shots$/).first()).toBeVisible({
      timeout: STAGE_TIMEOUT,
    });
    await expect(page.getByText(/^Shot \d+\.\d+$/).first()).toBeVisible();
    // The shots speak with the show's own cast, not a stranger's.
    await expect(
      page.getByText(/Mara Okafor|Theo Lindqvist/).first(),
    ).toBeVisible();
    await snap(page, '05-shots');

    // --- 5. Voice (enqueued: the voice queue → voice worker → ElevenLabs stand-in).
    await page.goto(`${episodeUrl}/audio-studio`, { timeout: STAGE_TIMEOUT }); // a first dev compile is slow
    const generateAll = byTest(page, 'generate-all-dialogue');
    await expect(generateAll).toBeEnabled({ timeout: STAGE_TIMEOUT });
    await snap(page, '06-dialogue-pending');
    const lastBefore = (await ledger())[0]?.id ?? 0;
    await generateAll.click();

    const spoken = async () =>
      (await ledger()).filter(
        (e) =>
          e.id > lastBefore &&
          e.vendor === 'elevenlabs' &&
          e.path.startsWith('/v1/text-to-speech/'),
      );
    await expect
      .poll(async () => (await spoken()).length, { timeout: STAGE_TIMEOUT })
      .toBeGreaterThan(0);
    for (const entry of await spoken()) expect(entry.status).toBe(200);
    // The Audio Studio plays through `new Audio(url)`, never an <audio>
    // element, so the proof is the page's own count and the stored files:
    // every line has a URL, and each one serves real audio (FILM-1806's local
    // R2 in the sandbox).
    await page.reload();
    // The banner and a toast both say it: either one will do.
    await expect(
      page
        .getByText(/All \d+ voice\(s\) generated/)
        .filter({ visible: true })
        .first(),
    ).toBeVisible({ timeout: STAGE_TIMEOUT });
    const lines = await readRows<{ audio_url: string | null }>(
      'dialogue_lines',
      `episode_id=eq.${episode.id}&select=audio_url`,
    );
    expect(lines.length).toBeGreaterThan(0);
    for (const { audio_url } of lines) {
      expect(audio_url).toBeTruthy();
      const audio = await fetch(audio_url!);
      expect(audio.status).toBe(200);
      expect(audio.headers.get('content-type')).toContain('audio/');
    }
    await snap(page, '07-dialogue-voiced');

    // --- Nothing reached a real vendor; every model call was the sandbox's.
    if (shoot) {
      await page.goto(`${CONTROL}/__sandbox`);
      await page.screenshot({
        path: `${OUT}/08-sandbox-ledger.png`,
        fullPage: true,
      });
    }
  });
});
