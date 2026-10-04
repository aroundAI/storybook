import { describe, expect, it, vi } from 'vitest';

import { DeliveryPackageSchema } from '../src/delivery-package.schema';
import { deliverEdit } from '../src/delivery.service';
import { getEditPackage } from '../src/server/load-edit-package';
import { REPORT } from './delivery-fixtures';
import {
  fakeClient,
  readRetention,
  seedTables,
  spyStorage,
} from './helpers/edit-package-db';

vi.mock('@kit/content-analytics/server/diagnostics-service', () => ({
  getEpisodeRetentionCurveService: vi.fn(async () => {
    throw new Error('the default analytics read must not run in these tests');
  }),
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }),
}));

/**
 * FILM-2003 AC4: when the episode changed in StoryBook during the edit,
 * deliver_edit's TARGET_CHANGED refusal hands back the current edit
 * package etag, the one get_edit_package would return now, so the Studio
 * can tell what it must re-sync to.
 */
const SESSION = '0f8b1f8e-6b0a-4d47-9a39-6a3c1f5b2a11';
const RENDER = '6f1e2d3c-4b5a-4968-8776-5544332211aa';

function delivery(episodeVersion: number) {
  return DeliveryPackageSchema.parse({
    sessionId: SESSION,
    episodeVersion,
    renders: [{ renderId: RENDER, primary: true }],
    report: REPORT,
    qa: { pass: true, issues: [] },
  });
}

describe('deliver_edit refused as TARGET_CHANGED', () => {
  it('carries the etag get_edit_package returns for the same episode', async () => {
    const { seed, tables } = seedTables();
    const scope = {
      accountId: seed.accountId,
      episodeId: seed.sources.episode.id,
    };
    const client = fakeClient({ ...tables, edit_events: [] }, [], {
      deliver_edit: () => ({
        ok: false,
        code: 'TARGET_CHANGED',
        currentVersion: 15,
        expectedVersion: 14,
      }),
    });

    const result = await deliverEdit(client, delivery(14), scope);

    const pkg = await getEditPackage(fakeClient(tables), {
      ...scope,
      storage: spyStorage(seed).storage,
      readRetention,
    });
    const etag = pkg.status === 'package' ? pkg.editPackage.etag : null;

    expect(etag).toMatch(/^v\d+-[0-9a-f]{40}$/);
    expect(result).toEqual({
      ok: false,
      code: 'TARGET_CHANGED',
      currentVersion: 15,
      expectedVersion: 14,
      etag,
    });
  });

  it('is null when the caller can no longer see the episode', async () => {
    const { seed, tables } = seedTables();
    const client = fakeClient(
      { ...tables, episodes: [], edit_events: [] },
      [],
      {
        deliver_edit: () => ({
          ok: false,
          code: 'TARGET_CHANGED',
          currentVersion: 15,
          expectedVersion: 14,
        }),
      },
    );

    const result = await deliverEdit(client, delivery(14), {
      accountId: seed.accountId,
      episodeId: seed.sources.episode.id,
    });

    expect(result).toMatchObject({ code: 'TARGET_CHANGED', etag: null });
  });

  it('reads no package for a delivery that is not refused as TARGET_CHANGED', async () => {
    const { seed, tables } = seedTables();
    const reads: Array<{ table: string }> = [];
    const client = fakeClient({ ...tables, edit_events: [] }, reads as never, {
      deliver_edit: () => ({ ok: false, code: 'NOT_FOUND' }),
    });

    const result = await deliverEdit(client, delivery(14), {
      accountId: seed.accountId,
      episodeId: seed.sources.episode.id,
    });

    expect(result).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(reads.map((read) => read.table)).toEqual(['edit_events']);
  });
});
