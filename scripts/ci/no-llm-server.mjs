#!/usr/bin/env node
/**
 * Starts the built web app with no model variables (FILM-1911).
 *
 *   node scripts/ci/no-llm-server.mjs [port]
 *
 * The no-LLM boot test (apps/e2e/tests/mcp/no-llm-boot.spec.ts) runs this as
 * PLAYWRIGHT_SERVER_COMMAND. Every variable whose name starts with a model
 * prefix is removed from the environment the server inherits, and the run
 * refuses to start if an env file Next.js would load in test mode sets one,
 * since Next would put it back. What is left is a deployment that holds no
 * key to any model, which must still start and serve every MCP tool.
 *
 * Needs `pnpm --filter web build:test` first; serves that build with
 * NODE_ENV=test, as `start:test` does.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODEL_PREFIXES = [
  'LLM_',
  'GEMINI_',
  'GOOGLE_',
  'VOYAGE_',
  'OPENAI_',
  'ANTHROPIC_',
];

const isModelVariable = (name) =>
  MODEL_PREFIXES.some((prefix) => name.startsWith(prefix));

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const web = join(root, 'apps', 'web');
const port = process.argv[2] ?? '3001';

// The files @next/env reads when NODE_ENV=test (.env.local is skipped in test)
const envFiles = ['.env.test.local', '.env.test', '.env'].map((file) =>
  join(web, file),
);

const fromFiles = envFiles.flatMap((file) =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .map((line) => line.replace(/^\s*export\s+/, '').split('=')[0].trim())
        .filter(isModelVariable)
        .map((name) => `${name} (${file})`)
    : [],
);

if (fromFiles.length > 0) {
  console.error(
    `no-llm-server: Next.js would load model variables from env files: ${fromFiles.join(', ')}`,
  );
  process.exit(1);
}

const removed = Object.keys(process.env).filter(isModelVariable).sort();
const env = Object.fromEntries(
  Object.entries(process.env).filter(([name]) => !isModelVariable(name)),
);

console.log(
  `no-llm-server: starting on port ${port} without ${removed.length} model variable(s)${removed.length ? `: ${removed.join(', ')}` : ''}`,
);

const server = spawn(
  join(web, 'node_modules', '.bin', 'next'),
  ['start', '-p', port],
  { cwd: web, env: { ...env, NODE_ENV: 'test' }, stdio: 'inherit' },
);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal));
}

server.on('exit', (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
