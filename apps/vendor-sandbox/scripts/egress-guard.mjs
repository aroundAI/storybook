/**
 * Egress guard, for verification runs only (FILM-1803 §7): preload it into a
 * local app server and any connection to a non-loopback address is refused
 * and recorded, so "nothing left the machine" is observed, not assumed.
 *
 *   NODE_OPTIONS="--import /abs/path/egress-guard.mjs" npx next dev -p 3144
 *
 * Every refusal is logged to stderr and appended to EGRESS_GUARD_LOG (default
 * .sandbox/egress-blocked.log in the working directory). It patches the
 * connect functions of `net` and `tls`, which the http/https modules and
 * undici (the global fetch) both go through.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import { dirname, resolve } from 'node:path';
import tls from 'node:tls';

const LOG = resolve(
  process.env.EGRESS_GUARD_LOG ?? '.sandbox/egress-blocked.log',
);
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0']);

function targetOf(args) {
  const [first, second] = args;
  if (first && typeof first === 'object') {
    if (first.path) return { local: true, label: first.path };
    const host = first.host ?? first.hostname ?? 'localhost';
    return {
      local: LOOPBACK.has(host) || host.startsWith('127.'),
      label: `${host}:${first.port}`,
    };
  }
  if (typeof first === 'string' && !/^\d+$/.test(first))
    return { local: true, label: first };
  const host = typeof second === 'string' ? second : 'localhost';
  return {
    local: LOOPBACK.has(host) || host.startsWith('127.'),
    label: `${host}:${first}`,
  };
}

function refuse(label) {
  const line = `${new Date().toISOString()} egress refused: ${label}\n`;
  process.stderr.write(`[egress-guard] ${line}`);
  try {
    mkdirSync(dirname(LOG), { recursive: true });
    appendFileSync(LOG, line);
  } catch {
    // the refusal itself still happens
  }
  const socket = new net.Socket();
  process.nextTick(() =>
    socket.destroy(new Error(`egress-guard: refused ${label}`)),
  );
  return socket;
}

for (const [module, names] of [
  [net, ['connect', 'createConnection']],
  [tls, ['connect']],
]) {
  for (const name of names) {
    const original = module[name];
    module[name] = function guarded(...args) {
      const target = targetOf(args);
      return target.local ? original.apply(this, args) : refuse(target.label);
    };
  }
}

syncBuiltinESMExports();
