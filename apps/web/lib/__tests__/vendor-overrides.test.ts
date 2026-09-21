import { beforeEach, describe, expect, it, vi } from 'vitest';

import { reportIgnoredVendorOverrides } from '../vendor-overrides';

const error = vi.fn();

vi.mock('@kit/shared/logger', () => ({
  getLogger: vi.fn(async () => ({ error })),
}));

/**
 * FILM-1801 §3: in production a `VENDOR_URL_*` is logged as an error and
 * ignored. The ignoring is `vendorUrl`'s and is tested in `@kit/shared`; this
 * is the logging.
 */
describe('reportIgnoredVendorOverrides', () => {
  beforeEach(() => {
    error.mockClear();
  });

  it('logs each override present in production as an error, by name only', async () => {
    const ignored = await reportIgnoredVendorOverrides({
      NODE_ENV: 'production',
      VENDOR_SANDBOX: '1',
      VENDOR_URL_TIKTOK: 'http://localhost:4102',
      VENDOR_URL_META_GRAPH: 'https://collector.example.com',
    });

    expect(ignored).toEqual(['VENDOR_URL_META_GRAPH', 'VENDOR_URL_TIKTOK']);
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]?.[0]).toEqual({
      name: 'vendor-overrides',
      ignored: ['VENDOR_URL_META_GRAPH', 'VENDOR_URL_TIKTOK'],
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain('collector');
  });

  it('says nothing when production carries no override', async () => {
    await reportIgnoredVendorOverrides({ NODE_ENV: 'production' });

    expect(error).not.toHaveBeenCalled();
  });

  it('says nothing about an override that is being honoured', async () => {
    await reportIgnoredVendorOverrides({
      NODE_ENV: 'development',
      VENDOR_SANDBOX: '1',
      VENDOR_URL_TIKTOK: 'http://localhost:4102',
    });

    expect(error).not.toHaveBeenCalled();
  });
});
