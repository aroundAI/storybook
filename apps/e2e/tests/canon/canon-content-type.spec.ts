import { expect, test } from '@playwright/test';

import { readRows, updateRows } from '../utils/seed';
import { CanonSettingsPageObject } from './canon-settings.po';

/**
 * KB-71: one content-type field. The Canon settings used to offer a "Content
 * Type" select (Series / Movie / Factual / News) that saved
 * `metadata.canon.contentType`, which nothing read — choosing "Factual" never
 * gave a season outline a single fact. The project's own type,
 * `metadata.projectType`, is what generation reads; the form now shows it and
 * no longer writes the dead field (owner decision, 2026-09-24).
 */

const OUT = process.env.EVIDENCE_DIR ?? 'evidence';
const evidence = Boolean(process.env.CAPTURE_EVIDENCE);

test.describe('Canon settings — content type (KB-71)', () => {
  test('shows the project type read-only, and saving twice drops the old field', async ({
    page,
  }) => {
    const canon = new CanonSettingsPageObject(page);
    const { team, project } = await canon.setup('documentary');

    // A project saved by the old form still carries the dead field.
    await updateRows('projects', `id=eq.${project.id}`, {
      metadata: {
        projectType: 'documentary',
        canon: { enabled: true, contentType: 'factual' },
      },
    });
    await canon.open(team, project);
    await canon.enableCanon();

    const type = page
      .locator('[data-test="canon-settings-project-type"]')
      .filter({ visible: true });
    await expect(type).toHaveText('Documentary');
    await expect(
      page
        .getByRole('combobox')
        .filter({ hasText: /Series|Movie|Factual|News/ }),
    ).toHaveCount(0);

    if (evidence) {
      await type.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${OUT}/kb71-01-canon-settings-type.png` });
    }

    // Save is enabled only by a change, so each save changes the horizon.
    await canon.setHorizon(5);
    await canon.save();

    // The second save, after the form reset itself from the first.
    await canon.setHorizon(7);
    await canon.save();

    // The first save's toast can still be on screen, so wait for the row
    // itself rather than trusting the second toast.
    const savedCanon = async () => {
      const [row] = await readRows<{
        metadata: { projectType?: string; canon?: Record<string, unknown> };
      }>('projects', `id=eq.${project.id}&select=metadata`);
      return row?.metadata;
    };

    await expect
      .poll(async () => (await savedCanon())?.canon?.memoryHorizon)
      .toBe(7);

    const saved = await savedCanon();
    expect(saved?.projectType).toBe('documentary');
    expect(saved?.canon).toMatchObject({ enabled: true, memoryHorizon: 7 });
    expect(saved?.canon).not.toHaveProperty('contentType');

    await canon.open(team, project);
    await expect(type).toHaveText('Documentary');
  });
});
