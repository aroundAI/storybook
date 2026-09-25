import { getLogger } from '@kit/shared/logger';
import {
  SDK_BASE_URL_VARIABLES,
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
  const sdkVariables = new Set<string>(SDK_BASE_URL_VARIABLES);
  const sdk = ignored.filter((name) => sdkVariables.has(name));
  const overrides = ignored.filter((name) => !sdkVariables.has(name));

  if (overrides.length > 0) {
    logger.error(
      { name: 'vendor-overrides', ignored: overrides },
      vendorSandboxEnabled(env)
        ? 'VENDOR_URL_* set for a vendor the resolver does not know; ignored'
        : 'VENDOR_URL_* is set but vendor overrides are disabled here (they need NODE_ENV=development or test, VENDOR_SANDBOX=1, and never run in a Lambda); ignored, real vendor hosts are in use',
    );
  }

  if (sdk.length > 0) {
    logger.error(
      { name: 'vendor-overrides', ignored: sdk },
      'An LLM SDK base-URL variable is set; ignored, because every client is built with a base URL from vendorUrl(). Use VENDOR_URL_* with VENDOR_SANDBOX=1 for a local stand-in',
    );
  }

  return ignored;
}
