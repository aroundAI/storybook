/**
 * The storage provider, and the public URLs it issues, read from the
 * environment alone. No `server-only`: the Lambda workers import this, and
 * they have neither a Supabase client nor R2 credentials, only the settings
 * that decide what a public URL looks like.
 *
 * Each adapter's `getPublicUrl(bucket, '')` gives the same prefix
 * (`public-url.test.ts` holds them to it), so a key read here is the key an
 * adapter would read.
 */

/**
 * The providers `STORAGE_PROVIDER` may name. `scripts/deploy.sh` refuses any
 * other value before a deploy (KB-70); keep its list the same.
 */
export const STORAGE_PROVIDERS = ['supabase', 'r2'] as const;

export type StorageProvider = (typeof STORAGE_PROVIDERS)[number];

export function isStorageProvider(value: string): value is StorageProvider {
  return (STORAGE_PROVIDERS as readonly string[]).includes(value);
}

type Env = Record<string, string | undefined>;

/**
 * The configured storage provider. Unset means Supabase, as in local dev and
 * CI. Any other value throws: `s3` used to fall back to Supabase silently,
 * though no S3 adapter exists (KB-70).
 */
export function getStorageProvider(env: Env = process.env): StorageProvider {
  const raw = env.STORAGE_PROVIDER;
  if (!raw) return 'supabase';

  const provider = raw.toLowerCase();
  if (isStorageProvider(provider)) return provider;

  throw new Error(
    `Unknown STORAGE_PROVIDER "${raw}": expected one of ${STORAGE_PROVIDERS.join(', ')} (KB-70)`,
  );
}

function withoutTrailingSlash(url: string) {
  return url.replace(/\/+$/, '');
}

/**
 * The prefix every public URL for `bucket` starts with, ending in `/`, or
 * null when the environment does not say (R2 without `R2_PUBLIC_URL`,
 * Supabase without its URL). Null means no URL can be recognised as the
 * app's own, so callers refuse rather than guess.
 */
export function publicUrlPrefix(
  bucket: string,
  env: Env = process.env,
): string | null {
  const provider = getStorageProvider(env);

  if (provider === 'r2') {
    const publicUrl = env.R2_PUBLIC_URL;
    return publicUrl ? `${withoutTrailingSlash(publicUrl)}/${bucket}/` : null;
  }

  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  return supabaseUrl
    ? `${withoutTrailingSlash(supabaseUrl)}/storage/v1/object/public/${bucket}/`
    : null;
}

/**
 * The object key behind `url` when it starts with `prefix`, or null: another
 * host, another bucket, or a key holding an empty or `..` segment. The query
 * and fragment are ignored.
 */
export function keyUnderPrefix(prefix: string, url: string): string | null {
  try {
    const base = prefix.endsWith('/') ? prefix : `${prefix}/`;
    const withoutQuery = url.split(/[?#]/)[0] ?? '';

    if (!withoutQuery.startsWith(base)) {
      return null;
    }

    const key = decodeURI(withoutQuery.slice(base.length));

    if (!key || key.split('/').some((part) => part === '' || part === '..')) {
      return null;
    }

    return key;
  } catch {
    return null;
  }
}

/** Whether `key` lies inside `folder`, read as a folder: `a/b` holds `a/b/c`, not `a/bc` */
export function isInFolder(key: string, folder: string) {
  return key.startsWith(folder.endsWith('/') ? folder : `${folder}/`);
}

/**
 * The key behind `url` when the app issued it for `bucket` and it lies inside
 * `folder`; otherwise null. The environment-only form of `ownedStorageKey`,
 * for code that has no adapter.
 */
export function ownedPublicKey(
  bucket: string,
  url: string,
  folder: string,
  env: Env = process.env,
): string | null {
  const prefix = publicUrlPrefix(bucket, env);
  const key = prefix ? keyUnderPrefix(prefix, url) : null;

  return key && isInFolder(key, folder) ? key : null;
}
