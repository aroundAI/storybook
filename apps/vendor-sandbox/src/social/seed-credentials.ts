import { SANDBOX_CLIENTS, TABLE_CLIENTS } from './credentials';

/**
 * `pnpm --filter vendor-sandbox seed-credentials` (FILM-1802 §2): writes the
 * sandbox's YouTube and Meta clients into the local database's
 * `oauth_app_credentials`, which is where the app reads those two apps'
 * credentials (`getOAuthAppCredentials`) first. TikTok can be saved there too
 * but falls back to its env pair when no row is saved, as LinkedIn and X do
 * (they have no row); the env block carries those.
 *
 * The secret is encrypted with the app's own `encrypt` under the local
 * ENCRYPTION_KEY, exactly as /admin/platforms stores it.
 *
 * It refuses any Supabase that is not on this machine, so no production
 * database or key can be written to, whatever is in the environment. It
 * reads only process.env, never a deployment file.
 */

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export interface SeedEnv {
  supabaseUrl: string;
  serviceRoleKey: string;
}

export function seedEnv(env: NodeJS.ProcessEnv = process.env): SeedEnv {
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? env.SUPABASE_URL ?? '';
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  let host = '';
  try {
    host = new URL(supabaseUrl).hostname;
  } catch {
    host = '';
  }

  if (!LOOPBACK.has(host)) {
    throw new Error(
      `seed-credentials writes only to a Supabase on this machine; NEXT_PUBLIC_SUPABASE_URL is "${supabaseUrl || '(unset)'}"`,
    );
  }
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
  }
  if (!env.ENCRYPTION_KEY) {
    throw new Error(
      'ENCRYPTION_KEY is not set; the app decrypts these secrets with it',
    );
  }

  return { supabaseUrl: supabaseUrl.replace(/\/+$/, ''), serviceRoleKey };
}

export async function seedCredentials(
  env: SeedEnv,
  encrypt: (plain: string) => Promise<string>,
  fetchImpl: typeof fetch = fetch,
) {
  const rows = await Promise.all(
    TABLE_CLIENTS.map(async (platform) => ({
      platform,
      client_id: SANDBOX_CLIENTS[platform].clientId,
      client_secret_encrypted: await encrypt(
        SANDBOX_CLIENTS[platform].clientSecret,
      ),
    })),
  );

  const response = await fetchImpl(
    `${env.supabaseUrl}/rest/v1/oauth_app_credentials?on_conflict=platform`,
    {
      method: 'POST',
      headers: {
        apikey: env.serviceRoleKey,
        Authorization: `Bearer ${env.serviceRoleKey}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(rows),
    },
  );

  if (!response.ok) {
    throw new Error(
      `oauth_app_credentials upsert failed (${response.status}): ${await response.text()}`,
    );
  }

  return rows.map((row) => row.platform);
}

async function main() {
  const env = seedEnv();
  // `@kit/shared/crypto` is server-only; this runs with
  // `--conditions=react-server`, and a dynamic import is how tsx loads it.
  const { encrypt } = await import('@kit/shared/crypto');
  const seeded = await seedCredentials(env, encrypt);
  console.log(
    `[sandbox] oauth_app_credentials: ${seeded.join(', ')} now use the sandbox clients`,
  );
}

if (process.argv[1]?.endsWith('seed-credentials.ts')) {
  main().catch((error: unknown) => {
    console.error(
      '[sandbox] seed-credentials failed:',
      error instanceof Error ? error.message : error,
    );
    process.exit(1);
  });
}
