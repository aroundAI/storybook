import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  META_GRAPH_VERSION,
  VENDORS,
  type Vendor,
  ignoredVendorOverrides,
  vendorSandboxEnabled,
  vendorUrl,
  vendorUrlEnvName,
} from '../src/vendors';

/**
 * FILM-1801. `VENDOR_URL_*` redirects requests that carry OAuth tokens and
 * API keys, so the cases that matter are the refusals: every way an override
 * could be honoured somewhere it must not be.
 */

const SANDBOX = 'http://localhost:4102';
const DEV = { NODE_ENV: 'development', VENDOR_SANDBOX: '1' };

const vendors = Object.keys(VENDORS) as Vendor[];

afterEach(() => {
  vi.unstubAllEnvs();
});

function everyOverrideSet(env: Record<string, string | undefined>) {
  return {
    ...env,
    ...Object.fromEntries(
      vendors.map((vendor) => [vendorUrlEnvName(vendor), SANDBOX]),
    ),
  };
}

describe('vendorUrl with no override', () => {
  it.each(vendors)('%s resolves to its real host', (vendor) => {
    expect(vendorUrl(vendor, {})).toBe(VENDORS[vendor]);
    expect(vendorUrl(vendor, DEV)).toBe(VENDORS[vendor]);
  });

  it('lists every host as a bare https origin, so callers own the path', () => {
    for (const host of Object.values(VENDORS)) {
      expect(new URL(host).origin).toBe(host);
      expect(host.startsWith('https://')).toBe(true);
    }
  });

  it('gives every vendor a distinct override name', () => {
    const names = vendors.map(vendorUrlEnvName);

    expect(new Set(names).size).toBe(names.length);
    expect(vendorUrlEnvName('meta-graph')).toBe('VENDOR_URL_META_GRAPH');
    expect(vendorUrlEnvName('tiktok')).toBe('VENDOR_URL_TIKTOK');
  });
});

describe('vendorUrl in local development', () => {
  it('honours an override when NODE_ENV is development and VENDOR_SANDBOX is 1', () => {
    expect(vendorUrl('tiktok', { ...DEV, VENDOR_URL_TIKTOK: SANDBOX })).toBe(
      SANDBOX,
    );
  });

  it('honours it under NODE_ENV=test, which is what `start:test` serves E2E with', () => {
    const env = {
      NODE_ENV: 'test',
      VENDOR_SANDBOX: '1',
      VENDOR_URL_TIKTOK: SANDBOX,
    };

    expect(vendorUrl('tiktok', env)).toBe(SANDBOX);
  });

  it('overrides only the vendor named', () => {
    const env = { ...DEV, VENDOR_URL_TIKTOK: SANDBOX };

    expect(vendorUrl('tiktok-oauth', env)).toBe(VENDORS['tiktok-oauth']);
    expect(vendorUrl('meta-graph', env)).toBe(VENDORS['meta-graph']);
  });

  it('drops a trailing slash, so `${vendorUrl(v)}/path` never doubles it', () => {
    expect(
      vendorUrl('tiktok', { ...DEV, VENDOR_URL_TIKTOK: `${SANDBOX}/` }),
    ).toBe(SANDBOX);
  });

  it.each([
    'http://localhost:4101',
    'http://127.0.0.1:4101',
    'http://[::1]:4101',
    'http://sandbox:4101',
    'http://host.docker.internal:4101',
    'http://meta.localhost:4101',
    'https://localhost:4101/meta',
  ])('accepts the local address %s', (value) => {
    expect(
      vendorUrl('meta-graph', { ...DEV, VENDOR_URL_META_GRAPH: value }),
    ).toBe(value);
  });
});

describe('vendorUrl fails closed', () => {
  it('ignores an override in production, sandbox flag and all', () => {
    const env = {
      NODE_ENV: 'production',
      VENDOR_SANDBOX: '1',
      VENDOR_URL_TIKTOK: SANDBOX,
    };

    expect(vendorUrl('tiktok', env)).toBe('https://open.tiktokapis.com');
  });

  it('ignores every override in production, for every vendor', () => {
    const env = everyOverrideSet({
      NODE_ENV: 'production',
      VENDOR_SANDBOX: '1',
    });

    for (const vendor of vendors) {
      expect(vendorUrl(vendor, env)).toBe(VENDORS[vendor]);
    }
  });

  it('reads the real process.env when none is passed', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VENDOR_SANDBOX', '1');
    vi.stubEnv('VENDOR_URL_TIKTOK', SANDBOX);

    expect(vendorUrl('tiktok')).toBe('https://open.tiktokapis.com');

    vi.stubEnv('NODE_ENV', 'development');

    expect(vendorUrl('tiktok')).toBe(SANDBOX);
  });

  it('ignores an override without VENDOR_SANDBOX=1', () => {
    for (const flag of [undefined, '', '0', 'true', 'yes', ' 1']) {
      const env = {
        NODE_ENV: 'development',
        VENDOR_SANDBOX: flag,
        VENDOR_URL_TIKTOK: SANDBOX,
      };

      expect(vendorUrl('tiktok', env)).toBe(VENDORS.tiktok);
    }
  });

  /**
   * The worker lambdas in `sst.config.ts` set no NODE_ENV. Under the rule
   * "anything but production" they would honour an override in production.
   */
  it('ignores an override when NODE_ENV is unset or unrecognised', () => {
    for (const nodeEnv of [undefined, '', 'staging', 'Production', 'prod']) {
      const env = {
        NODE_ENV: nodeEnv,
        VENDOR_SANDBOX: '1',
        VENDOR_URL_TIKTOK: SANDBOX,
      };

      expect(vendorSandboxEnabled(env)).toBe(false);
      expect(vendorUrl('tiktok', env)).toBe(VENDORS.tiktok);
    }
  });

  it('ignores an override inside an AWS Lambda, whatever NODE_ENV says', () => {
    const env = {
      ...DEV,
      AWS_LAMBDA_FUNCTION_NAME: 'publish-worker',
      VENDOR_URL_TIKTOK: SANDBOX,
    };

    expect(vendorSandboxEnabled(env)).toBe(false);
    expect(vendorUrl('tiktok', env)).toBe(VENDORS.tiktok);
  });

  it.each([
    'https://evil.example.com',
    'https://open.tiktokapis.com.evil.example',
    'http://10.0.0.5:4102',
    'http://192.168.1.20:4102',
    'http://169.254.169.254',
    'http://[2001:db8::1]:4102',
    'http://localhost.evil.example',
    'http://user:pass@localhost:4102',
    'http://localhost:4102/?next=https://evil.example.com',
    'ftp://localhost:4102',
    'file:///etc/passwd',
    'localhost:4102',
    'not a url',
  ])('throws on %s rather than sending a token there', (value) => {
    const env = { ...DEV, VENDOR_URL_TIKTOK: value };

    expect(() => vendorUrl('tiktok', env)).toThrow(/VENDOR_URL_TIKTOK must be/);
  });

  it('never throws in production, however malformed the override', () => {
    const env = {
      NODE_ENV: 'production',
      VENDOR_SANDBOX: '1',
      VENDOR_URL_TIKTOK: 'not a url',
    };

    expect(vendorUrl('tiktok', env)).toBe(VENDORS.tiktok);
  });
});

describe('ignoredVendorOverrides: LOCAL_API_URL (KB-21)', () => {
  const env = {
    NODE_ENV: 'production',
    LOCAL_API_URL: 'http://localhost:11434',
  };

  it('names it while the sandbox is off, and not while it is on', () => {
    expect(ignoredVendorOverrides(env)).toEqual(['LOCAL_API_URL']);
    expect(
      ignoredVendorOverrides({
        NODE_ENV: 'development',
        VENDOR_SANDBOX: '1',
        LOCAL_API_URL: 'http://localhost:11434',
      }),
    ).toEqual([]);
  });
});

describe('ignoredVendorOverrides', () => {
  it('names every VENDOR_URL_* present in production', () => {
    const env = {
      NODE_ENV: 'production',
      VENDOR_SANDBOX: '1',
      VENDOR_URL_TIKTOK: SANDBOX,
      VENDOR_URL_META_GRAPH: 'http://localhost:4101',
      UNRELATED: 'x',
    };

    expect(ignoredVendorOverrides(env)).toEqual([
      'VENDOR_URL_META_GRAPH',
      'VENDOR_URL_TIKTOK',
    ]);
  });

  it('names them when the sandbox flag is missing in development', () => {
    expect(
      ignoredVendorOverrides({
        NODE_ENV: 'development',
        VENDOR_URL_TIKTOK: SANDBOX,
      }),
    ).toEqual(['VENDOR_URL_TIKTOK']);
  });

  it('names only a misspelt vendor when the sandbox is on', () => {
    const env = {
      ...DEV,
      VENDOR_URL_TIKTOK: SANDBOX,
      VENDOR_URL_TIKTOCK: SANDBOX,
    };

    expect(ignoredVendorOverrides(env)).toEqual(['VENDOR_URL_TIKTOCK']);
  });

  it('names every LLM SDK base-URL variable that is set, in any environment (FILM-1805)', () => {
    const set = {
      ANTHROPIC_BASE_URL: 'https://proxy.example.com',
      GOOGLE_GEMINI_BASE_URL: 'https://proxy.example.com',
      GOOGLE_VERTEX_BASE_URL: 'https://proxy.example.com',
      OPENAI_BASE_URL: 'https://proxy.example.com/v1',
    };

    for (const env of [{ NODE_ENV: 'production' }, DEV]) {
      expect(ignoredVendorOverrides({ ...env, ...set })).toEqual([
        'ANTHROPIC_BASE_URL',
        'GOOGLE_GEMINI_BASE_URL',
        'GOOGLE_VERTEX_BASE_URL',
        'OPENAI_BASE_URL',
      ]);
    }
  });

  it('is empty when nothing is set', () => {
    expect(ignoredVendorOverrides({ NODE_ENV: 'production' })).toEqual([]);
  });
});

/**
 * The vendor files build their bases when first imported, so this is the path
 * a request actually takes: environment, then import, then the constant.
 */
describe('the vendor constants built on the resolver', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  // The version guard scans tests too, so these hosts are read, not restated.
  const GRAPH = VENDORS['meta-graph'];
  const X_API = VENDORS['x-api'];

  async function freshVendors() {
    vi.resetModules();

    return import('../src/vendors');
  }

  it('point at the real hosts with nothing set', async () => {
    const { META_GRAPH_BASE, META_OAUTH_DIALOG_URL, X_API_BASE } =
      await freshVendors();

    expect(META_GRAPH_BASE).toBe(`${GRAPH}/${META_GRAPH_VERSION}`);
    expect(META_OAUTH_DIALOG_URL).toBe(
      `https://www.facebook.com/${META_GRAPH_VERSION}/dialog/oauth`,
    );
    expect(X_API_BASE).toBe(`${X_API}/2`);
  });

  it('follow an override in development, keeping the pinned version path', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('VENDOR_SANDBOX', '1');
    vi.stubEnv('VENDOR_URL_META_GRAPH', 'http://localhost:4101');

    const { META_GRAPH_BASE, META_OAUTH_TOKEN_URL, X_API_BASE } =
      await freshVendors();

    expect(META_GRAPH_BASE).toBe(`http://localhost:4101/${META_GRAPH_VERSION}`);
    expect(META_OAUTH_TOKEN_URL).toBe(
      `http://localhost:4101/${META_GRAPH_VERSION}/oauth/access_token`,
    );
    expect(X_API_BASE).toBe(`${X_API}/2`);
  });

  it('stay on the real hosts in production with the same override set', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('VENDOR_SANDBOX', '1');
    vi.stubEnv('VENDOR_URL_META_GRAPH', 'http://localhost:4101');
    vi.stubEnv('VENDOR_URL_X_API', 'http://localhost:4104');

    const {
      META_GRAPH_BASE,
      META_OAUTH_TOKEN_URL,
      X_API_BASE,
      X_MEDIA_UPLOAD,
    } = await freshVendors();

    expect(META_GRAPH_BASE).toBe(`${GRAPH}/${META_GRAPH_VERSION}`);
    expect(META_OAUTH_TOKEN_URL).toBe(
      `${GRAPH}/${META_GRAPH_VERSION}/oauth/access_token`,
    );
    expect(X_API_BASE).toBe(`${X_API}/2`);
    expect(X_MEDIA_UPLOAD.initialize).toBe(
      `${X_API}/2/media/upload/initialize`,
    );
  });
});

describe('ignoredVendorOverrides: LLM_FORCE_PROVIDER (FILM-1805)', () => {
  it('names it while the sandbox is off, and not while it is on', () => {
    expect(
      ignoredVendorOverrides({
        NODE_ENV: 'production',
        LLM_FORCE_PROVIDER: 'local',
      }),
    ).toEqual(['LLM_FORCE_PROVIDER']);
    expect(
      ignoredVendorOverrides({
        NODE_ENV: 'development',
        VENDOR_SANDBOX: '1',
        LLM_FORCE_PROVIDER: 'local',
      }),
    ).toEqual([]);
  });
});
