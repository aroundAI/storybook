import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BRAND_DEFAULTS, EDIT_POLICY_DEFAULTS } from '@kit/desktop-integration';

import { updateProjectEditPolicyAction } from '../../edit-policy/_lib/server/actions';
import { updateProjectBrandAction } from '../_lib/server/actions';

/**
 * FILM-2004: the Brand and Edit policy actions. A caller needs the team's
 * settings.manage (checked by the action) and a project owner/admin role
 * (projects_update, which updates no row otherwise). Each refusal comes
 * back as a value, and nothing is written.
 */

const PROJECT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const OWN_ASSET = '11111111-1111-4111-8111-111111111111';
const OTHER_ASSET = '33333333-3333-4333-8333-333333333333';

const db = vi.hoisted(() => ({
  hasPermission: true,
  updatedRows: [{ id: 'p', updated_at: '2026-10-04T12:00:00Z' }] as unknown[],
  ownAssets: [] as string[],
  updates: [] as Array<Record<string, unknown>>,
  rpcs: [] as Array<{ name: string; args: unknown }>,
}));

vi.mock('@kit/supabase/require-user', () => ({
  requireUser: vi.fn(() =>
    Promise.resolve({ data: { id: 'user-1' }, error: null }),
  ),
}));

vi.mock('@kit/audit-logs/server', () => ({
  createAuditLog: vi.fn(() => Promise.resolve()),
  extractNetworkContext: vi.fn(() => Promise.resolve({})),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => ({
    rpc: (name: string, args: unknown) => {
      db.rpcs.push({ name, args });
      return Promise.resolve({ data: db.hasPermission, error: null });
    },
    from: (table: string) => {
      let inIds: string[] = [];
      let update: Record<string, unknown> | null = null;
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: (_column: string, ids: string[]) => ((inIds = ids), chain),
        update: (values: Record<string, unknown>) => ((update = values), chain),
        single: () =>
          Promise.resolve({
            data: {
              id: PROJECT_ID,
              name: 'Brand film',
              account_id: ACCOUNT_ID,
              brand: {},
              edit_policy: {},
            },
            error: null,
          }),
        is: () =>
          Promise.resolve({
            data: inIds
              .filter((id) => db.ownAssets.includes(id))
              .map((id) => ({ id })),
            error: null,
          }),
        then: (resolve: (value: unknown) => void) => {
          if (table === 'projects' && update) db.updates.push(update);
          resolve({ data: db.updatedRows, error: null });
        },
      };
      return chain;
    },
  }),
}));

beforeEach(() => {
  db.hasPermission = true;
  db.updatedRows = [{ id: PROJECT_ID, updated_at: '2026-10-04T12:00:00Z' }];
  db.ownAssets = [];
  db.updates = [];
  db.rpcs = [];
});

const brand = {
  ...BRAND_DEFAULTS,
  colors: { ...BRAND_DEFAULTS.colors, captionText: '#FF0000' },
};

describe('updateProjectBrandAction', () => {
  it('writes the brand for a project admin with settings.manage, and reads it back', async () => {
    await expect(
      updateProjectBrandAction({ projectId: PROJECT_ID, brand }),
    ).resolves.toEqual({
      ok: true,
      data: { projectId: PROJECT_ID, updatedAt: '2026-10-04T12:00:00Z' },
    });
    expect(db.updates).toEqual([{ brand }]);
    expect(db.rpcs).toEqual([
      {
        name: 'has_permission',
        args: {
          user_id: 'user-1',
          account_id: ACCOUNT_ID,
          permission_name: 'settings.manage',
        },
      },
    ]);
  });

  it('refuses a member without settings.manage, as a value, writing nothing', async () => {
    db.hasPermission = false;

    await expect(
      updateProjectBrandAction({ projectId: PROJECT_ID, brand }),
    ).resolves.toEqual({
      ok: false,
      error:
        "Changing the brand needs the team's settings permission. Ask a team owner.",
    });
    expect(db.updates).toEqual([]);
  });

  it('refuses a caller RLS lets update no row (not a project owner or admin)', async () => {
    db.updatedRows = [];

    await expect(
      updateProjectBrandAction({ projectId: PROJECT_ID, brand }),
    ).resolves.toEqual({
      ok: false,
      error: 'Only a project owner or admin can change the brand.',
    });
  });

  it("refuses a logo or intro that is not one of the project's assets", async () => {
    db.ownAssets = [OWN_ASSET];

    await expect(
      updateProjectBrandAction({
        projectId: PROJECT_ID,
        brand: {
          ...brand,
          logo: { ...brand.logo, assetId: OWN_ASSET },
          introAssetId: OTHER_ASSET,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: expect.stringMatching(/assets of this project/),
    });
    expect(db.updates).toEqual([]);

    await expect(
      updateProjectBrandAction({
        projectId: PROJECT_ID,
        brand: { ...brand, logo: { ...brand.logo, assetId: OWN_ASSET } },
      }),
    ).resolves.toMatchObject({ ok: true });
  });

  it('refuses an invalid colour before anything is read', async () => {
    await expect(
      updateProjectBrandAction({
        projectId: PROJECT_ID,
        brand: { ...brand, colors: { ...brand.colors, captionText: 'red' } },
      }),
    ).rejects.toThrow();
    expect(db.rpcs).toEqual([]);
    expect(db.updates).toEqual([]);
  });
});

describe('updateProjectEditPolicyAction', () => {
  it('writes the policy for a caller with settings.manage', async () => {
    const editPolicy = { ...EDIT_POLICY_DEFAULTS, maxShotLength: 4 };

    await expect(
      updateProjectEditPolicyAction({ projectId: PROJECT_ID, editPolicy }),
    ).resolves.toMatchObject({ ok: true });
    expect(db.updates).toEqual([{ edit_policy: editPolicy }]);
  });

  it('refuses a member without settings.manage, writing nothing', async () => {
    db.hasPermission = false;

    await expect(
      updateProjectEditPolicyAction({
        projectId: PROJECT_ID,
        editPolicy: EDIT_POLICY_DEFAULTS,
      }),
    ).resolves.toEqual({
      ok: false,
      error:
        "Changing the edit policy needs the team's settings permission. Ask a team owner.",
    });
    expect(db.updates).toEqual([]);
  });

  it('refuses a shortest shot longer than the longest', async () => {
    await expect(
      updateProjectEditPolicyAction({
        projectId: PROJECT_ID,
        editPolicy: {
          ...EDIT_POLICY_DEFAULTS,
          minShotLength: 5,
          maxShotLength: 3,
        },
      }),
    ).rejects.toThrow();
    expect(db.updates).toEqual([]);
  });
});
