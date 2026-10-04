import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BRAND_DEFAULTS, EDIT_POLICY_DEFAULTS } from '@kit/desktop-integration';

import { updateProjectTool } from '../../src/server/tools/author/projects';
import { getProjectTool } from '../../src/server/tools/read/projects';
import {
  type RecordedCall,
  createFakeClient,
  fakeContext,
} from '../helpers/fake-supabase';

/**
 * FILM-2004: get_project hands an MCP client the brand and edit policy with
 * every default applied; update_project takes a partial of either, merges it
 * group by group onto what is stored, and validates the result with the
 * same schemas the settings pages use.
 */

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';

function projectRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROJECT_ID,
    account_id: ACCOUNT_ID,
    name: 'Brand film',
    slug: 'brand-film',
    description: null,
    status: 'active',
    metadata: {},
    brand: {},
    edit_policy: {},
    created_at: '2026-10-04T00:00:00Z',
    updated_at: '2026-10-04T00:00:00Z',
    ...overrides,
  };
}

function fakeProjects(stored: Record<string, unknown> = {}) {
  return createFakeClient({
    projects: (call: RecordedCall) =>
      call.op === 'update'
        ? { data: projectRow({ ...stored, ...(call.payload as object) }) }
        : { data: projectRow(stored) },
  });
}

const updateInput = (extra: Record<string, unknown>) =>
  ({ projectId: PROJECT_ID, ...extra }) as Parameters<
    typeof updateProjectTool.handler
  >[0];

describe('get_project: brand and editPolicy', () => {
  it('returns the full defaults for a project that never set them', async () => {
    const fake = fakeProjects();
    const result = await getProjectTool.handler(
      { projectId: PROJECT_ID },
      fakeContext(fake.client),
    );

    expect(result.structuredContent).toMatchObject({
      brand: BRAND_DEFAULTS,
      editPolicy: EDIT_POLICY_DEFAULTS,
    });
    expect(result.structuredContent).not.toHaveProperty('issues');
    expect(
      fake.calls.find((call) => call.table === 'projects')?.columns,
    ).toMatch(/brand, edit_policy/);
  });

  it('fills the defaults around what is stored', async () => {
    const fake = fakeProjects({
      brand: { colors: { captionText: '#FF0000' } },
      edit_policy: { maxShotLength: 4 },
    });
    const result = await getProjectTool.handler(
      { projectId: PROJECT_ID },
      fakeContext(fake.client),
    );

    expect(result.structuredContent.brand).toEqual({
      ...BRAND_DEFAULTS,
      colors: { ...BRAND_DEFAULTS.colors, captionText: '#FF0000' },
    });
    expect(result.structuredContent.editPolicy).toEqual({
      ...EDIT_POLICY_DEFAULTS,
      maxShotLength: 4,
    });
  });
});

describe('update_project: brand and editPolicy', () => {
  const schema = z.object(updateProjectTool.inputSchema);

  it('refuses an invalid colour and an unknown transition before the handler runs', () => {
    expect(
      schema.safeParse({
        projectId: PROJECT_ID,
        brand: { colors: { captionText: 'red' } },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        projectId: PROJECT_ID,
        editPolicy: { transitions: { preferred: ['wipe'] } },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({
        projectId: PROJECT_ID,
        brand: { colors: { captionText: '#FF0000' } },
      }).success,
    ).toBe(true);
  });

  it('writes the stored brand with only the named field changed', async () => {
    const fake = fakeProjects({
      brand: { colors: { primary: '#111111' }, transitionStyle: 'dip' },
    });

    const result = await updateProjectTool.handler(
      updateInput({ brand: { colors: { captionText: '#FF0000' } } }),
      fakeContext(fake.client),
    );

    const update = fake.calls.find((call) => call.op === 'update');
    expect(update?.payload).toEqual({
      brand: {
        ...BRAND_DEFAULTS,
        colors: {
          ...BRAND_DEFAULTS.colors,
          primary: '#111111',
          captionText: '#FF0000',
        },
        transitionStyle: 'dip',
      },
    });
    expect(result.text).toMatch(/: brand\.$/);
    expect(result.structuredContent).toHaveProperty(
      'brand.colors.captionText',
      '#FF0000',
    );
  });

  it("refuses a logo that is not one of the project's assets, writing nothing", async () => {
    const fake = createFakeClient({
      projects: { ...projectRow() },
      assets: [],
    });

    await expect(
      updateProjectTool.handler(
        updateInput({
          brand: { logo: { assetId: '99999999-9999-4999-8999-999999999999' } },
        }),
        fakeContext(fake.client),
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      message: expect.stringMatching(/assets of this project/),
    });
    expect(fake.calls.some((call) => call.op === 'update')).toBe(false);
  });

  it('refuses a policy whose merged min shot is longer than its max, writing nothing', async () => {
    const fake = fakeProjects({ edit_policy: { maxShotLength: 3 } });

    await expect(
      updateProjectTool.handler(
        updateInput({ editPolicy: { minShotLength: 4 } }),
        fakeContext(fake.client),
      ),
    ).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
      details: {
        errors: [
          {
            path: ['editPolicy', 'minShotLength'],
            message: expect.stringMatching(/shortest shot/),
          },
        ],
      },
    });
    expect(fake.calls.some((call) => call.op === 'update')).toBe(false);
  });

  it('writes an edit policy alongside a series setting in one update', async () => {
    const fake = fakeProjects();

    await updateProjectTool.handler(
      updateInput({ genre: 'comedy', editPolicy: { music: { duckDb: -12 } } }),
      fakeContext(fake.client),
    );

    const update = fake.calls.find((call) => call.op === 'update');
    expect(update?.payload).toMatchObject({
      metadata: { genre: 'comedy' },
      edit_policy: {
        ...EDIT_POLICY_DEFAULTS,
        music: { ...EDIT_POLICY_DEFAULTS.music, duckDb: -12 },
      },
    });
  });
});
