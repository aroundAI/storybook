import type { Vendor } from '@kit/shared/vendors';

import { CLIENT_ENV, SANDBOX_CLIENTS } from './credentials';
import { SOCIAL_ORIGINS } from './server';

/**
 * The social half of the vendor-sandbox block in local.env (FILM-1802 §2),
 * printed by `scripts/lib/vendor-sandbox-env.d/social.sh`, which ai-sandbox's
 * `ensure_sandbox_env` runs inside the block on every `local-env.sh up`.
 *
 * Generated here rather than written in shell so the ports, resolver names
 * and client ids have one source: the same constants the sandbox serves
 * with.
 */
export function socialEnvLines(
  portBase = 4100,
  envName: (vendor: Vendor) => string,
): string[] {
  const offset = portBase - 4100;
  const lines = ['# FILM-1802 social platforms'];

  for (const { port, resolverNames } of Object.values(SOCIAL_ORIGINS)) {
    for (const name of resolverNames) {
      lines.push(`${envName(name)}=http://127.0.0.1:${port + offset}`);
    }
  }

  for (const [app, [idVar, secretVar]] of Object.entries(CLIENT_ENV)) {
    const client = SANDBOX_CLIENTS[app as keyof typeof CLIENT_ENV];
    lines.push(
      `${idVar}=${client.clientId}`,
      `${secretVar}=${client.clientSecret}`,
    );
  }

  return lines;
}

async function main() {
  const { vendorUrlEnvName } = await import('@kit/shared/vendors');
  const base = Number(process.env.SANDBOX_PORT_BASE || 4100);
  if (!Number.isInteger(base)) {
    throw new Error(
      `SANDBOX_PORT_BASE must be an integer, got "${process.env.SANDBOX_PORT_BASE}"`,
    );
  }
  console.log(socialEnvLines(base, vendorUrlEnvName).join('\n'));
}

if (process.argv[1]?.endsWith('env-lines.ts')) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
