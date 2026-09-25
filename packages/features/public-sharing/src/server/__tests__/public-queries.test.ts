import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getPublicCompany,
  getPublicEpisode,
  getPublicProject,
} from '../public-queries';

/**
 * KB-88 hid for months because every public read turned an error into
 * `null`, and the page into a 404: "permission denied for schema public"
 * looked exactly like a slug nobody had published. A missing row is still a
 * quiet 404; a failed read is now logged.
 */

const logger = vi.hoisted(() => ({ error: vi.fn() }));
const result = vi.hoisted(() => ({
  current: { data: null as unknown, error: null as unknown },
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => logger,
}));

vi.mock('@kit/supabase/server-client', () => ({
  getSupabaseServerClient: () => {
    const builder: Record<string, unknown> = {};
    const chain = () => builder;

    for (const method of [
      'from',
      'rpc',
      'select',
      'eq',
      'in',
      'not',
      'neq',
      'order',
    ]) {
      builder[method] = vi.fn(chain);
    }

    builder.maybeSingle = vi.fn(async () => result.current);
    builder.single = vi.fn(async () => result.current);

    return builder;
  },
}));

const company = {
  id: 'a1',
  name: 'Co',
  slug: 'co',
  picture_url: null,
  public_profile: { is_public: true },
};

const project = {
  id: 'p1',
  account_id: 'a1',
  name: 'Show',
  description: null,
  public_slug: 'show',
  visibility: 'public',
  metadata: {},
  seo_metadata: {},
  created_at: null,
  updated_at: null,
  account: { id: 'a1', name: 'Co', slug: 'co' },
};

const denied = {
  code: '42501',
  message: 'permission denied for schema public',
};

describe('public reads', () => {
  beforeEach(() => {
    logger.error.mockReset();
    result.current = { data: null, error: null };
  });

  it.each([
    ['company', () => getPublicCompany('co')],
    ['project', () => getPublicProject(company, 'show')],
    ['episode', () => getPublicEpisode(project, 'pilot')],
  ])('a missing %s is a quiet null', async (_name, read) => {
    await expect(read()).resolves.toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each([
    ['company', () => getPublicCompany('co')],
    ['project', () => getPublicProject(company, 'show')],
    ['episode', () => getPublicEpisode(project, 'pilot')],
  ])(
    'a failed %s read is logged with its code, then a null',
    async (_name, read) => {
      result.current = { data: null, error: denied };

      await expect(read()).resolves.toBeNull();
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.error.mock.calls[0]![0]).toMatchObject({ code: '42501' });
    },
  );
});
