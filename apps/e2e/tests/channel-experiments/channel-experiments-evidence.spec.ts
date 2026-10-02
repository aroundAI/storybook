import { Page, expect, test } from '@playwright/test';

import { byTest } from '../utils/visible';
import { ChannelExperimentsPage } from './channel-experiments.po';
import { cell, seedResultsScenario } from './results-scenario';

/**
 * Screenshots for the FILM-1724 PR, in both themes, and the figures read
 * off the page for its comment. Not a guard — `channel-experiments.spec.ts`
 * holds those. Skipped unless CAPTURE_EVIDENCE is set; the results need
 * CLICKHOUSE_EVIDENCE and a server reading the local ClickHouse.
 */
const OUT = process.env.EVIDENCE_DIR ?? 'evidence';

async function shoot(page: Page, name: string, locator = page.locator('main')) {
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate((value) => localStorage.setItem('theme', value), theme);
    await page.reload();
    await expect(byTest(page, 'ce-form')).toBeVisible();
    await page.waitForLoadState('networkidle');
    await locator.first().screenshot({ path: `${OUT}/${name}-${theme}.png` });
  }
  await page.evaluate(() => localStorage.setItem('theme', 'light'));
}

test.describe('Channel experiments — evidence', () => {
  test.skip(
    !process.env.CAPTURE_EVIDENCE,
    'Set CAPTURE_EVIDENCE=1 to regenerate the PR screenshots.',
  );
  test.describe.configure({ timeout: 300_000 });
  test.use({ viewport: { width: 1280, height: 1800 } });

  test('the create form, filled, after a save, and refusing a repeated name', async ({
    page,
  }) => {
    const po = new ChannelExperimentsPage(page);
    const team = await po.setup();

    const fill = async () => {
      await po.field('ce-title').fill('Five thumbnail styles');
      await po.choose(
        po.field('ce-channel'),
        `ce-channel-option-${team.connectionId}`,
      );
      await po.fillStyles(['Faces', 'Text', 'Product']);
      await po.field('ce-hypothesis').fill('Faces pull more clicks');
    };

    // Filled forms are lost on reload, so these two are light only.
    await fill();
    await po.form().screenshot({ path: `${OUT}/01-form-filled-light.png` });
    await po.submitAndWaitForReset();
    await po.form().screenshot({ path: `${OUT}/02-form-after-save-light.png` });

    await po.field('ce-title').fill('Repeated');
    await po.choose(
      po.field('ce-channel'),
      `ce-channel-option-${team.connectionId}`,
    );
    await po.fillStyles(['Same', 'same']);
    await po.field('ce-submit').click();
    await expect(
      po.form().getByText('Each style needs its own name'),
    ).toBeVisible();
    await po
      .form()
      .screenshot({ path: `${OUT}/03-form-repeated-name-light.png` });
  });

  test('results fill in, a verdict appears, and the experiment concludes', async ({
    page,
  }) => {
    test.skip(
      !process.env.CLICKHOUSE_EVIDENCE,
      'Set CLICKHOUSE_EVIDENCE=1 with a server reading the local ClickHouse.',
    );

    const po = new ChannelExperimentsPage(page);
    const scenario = await seedResultsScenario(page, po);
    const { open, closed } = scenario;
    const detail = byTest(page, 'ce-detail');

    const read = async () => {
      const figures: Record<string, string | null> = {};
      for (const [measure, checkpoint] of [
        ['views', 7],
        ['views', 30],
        ['ctr', 7],
      ] as const) {
        for (const [label, id] of [
          ['open', open],
          ['closed', closed],
        ] as const) {
          for (const part of ['median', 'range', 'measured', 'pending']) {
            figures[`${measure}@${checkpoint} ${label} ${part}`] = await cell(
              page,
              measure,
              checkpoint,
              id,
              part,
            ).textContent();
          }
        }
        figures[`${measure}@${checkpoint} verdict`] = await byTest(
          page,
          `ce-verdict-${measure}-${checkpoint}`,
        ).textContent();
      }
      return figures;
    };

    await shoot(page, '04-running-no-verdict-yet', detail);
    console.log('READINGS_BEFORE', JSON.stringify(await read()));

    await po.assign(scenario.fifthOpen);
    await expect(byTest(page, 'ce-verdict-views-7')).toContainText(
      'is ahead of',
    );
    await shoot(page, '05-running-verdict', detail);
    console.log('READINGS_AFTER', JSON.stringify(await read()));

    await po
      .inDetail('ce-conclusion-input')
      .fill('Closed mouths win at 7 days');
    await po.inDetail('ce-conclude-confirmed').click();
    await expect(po.inDetail('ce-status')).toHaveText('concluded');
    await shoot(page, '06-concluded', detail);
    console.log('READINGS_CONCLUDED', JSON.stringify(await read()));
  });
});
