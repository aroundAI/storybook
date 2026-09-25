import { DEFAULT_PORTS, type PortName, createSandbox } from './sandbox';

/**
 * `pnpm --filter vendor-sandbox start`. Reads its own SANDBOX_* settings
 * and nothing else: no vendor keys, no app configuration.
 *
 * - SANDBOX_SEED        replay a run (logged at start otherwise)
 * - SANDBOX_PORT_BASE   shift every port (default 4100)
 * - SANDBOX_QUALITY     high (default) or low: where generated scores sit
 */
const KNOWN = new Set(['SANDBOX_SEED', 'SANDBOX_PORT_BASE', 'SANDBOX_QUALITY']);

function integer(name: string) {
  const value = process.env[name];
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed))
    throw new Error(`${name} must be an integer, got "${value}"`);
  return parsed;
}

async function main() {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith('SANDBOX_') && !KNOWN.has(name)) {
      console.warn(`[sandbox] ${name} is not a setting here; ignored`);
    }
  }

  const base = integer('SANDBOX_PORT_BASE') ?? DEFAULT_PORTS.control;
  const offset = base - DEFAULT_PORTS.control;
  const ports = Object.fromEntries(
    Object.entries(DEFAULT_PORTS).map(([name, port]) => [name, port + offset]),
  ) as Record<PortName, number>;

  const quality = process.env.SANDBOX_QUALITY === 'low' ? 'low' : 'high';
  const sandbox = await createSandbox({
    seed: integer('SANDBOX_SEED'),
    quality,
    ports,
  });

  console.log(
    `[sandbox] seed ${sandbox.state.seed}; ${sandbox.state.catalog.length} prompts; ` +
      Object.entries(sandbox.urls)
        .map(([name, url]) => `${name} ${url}`)
        .join(', '),
  );

  const stop = () => {
    void sandbox.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((error: unknown) => {
  console.error(
    '[sandbox] failed to start:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
