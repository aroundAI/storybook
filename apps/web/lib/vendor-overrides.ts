import { getLogger } from '@kit/shared/logger';
import {
  ignoredVendorOverrides,
  vendorSandboxEnabled,
} from '@kit/shared/vendors';

type Env = Record<string, string | undefined>;

/**
 * Run once at server start (FILM-1801). A `VENDOR_URL_*` that will not be
 * honoured - any of them in production - is logged as an error by name, never
 * by value, and the server carries on against the real vendor.
 */
export async function reportIgnoredVendorOverrides(env: Env = process.env) {
  const ignored = ignoredVendorOverrides(env);

  if (ignored.length === 0) return ignored;

  const logger = await getLogger();

  logger.error(
    { name: 'vendor-overrides', ignored },
    vendorSandboxEnabled(env)
      ? 'VENDOR_URL_* set for a vendor the resolver does not know; ignored'
      : 'VENDOR_URL_* is set but vendor overrides are disabled here (they need NODE_ENV=development or test, VENDOR_SANDBOX=1, and never run in a Lambda); ignored, real vendor hosts are in use',
  );

  return ignored;
}
