import { type Handler, parseJson, sendJson } from './http';
import { drawSeed } from './rng';
import type { SocialState } from './social/state';
import type { FailureRule, SandboxState } from './state';
import type { SandboxVersion } from './version';

/**
 * Port 4100: the control API and ledger (FILM-1802 §6), plus a status page.
 * Loopback only, like every port here.
 */

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function statusPage(state: SandboxState, ports: Record<string, number>) {
  const counts = new Map<string, number>();
  for (const entry of state.ledger.list())
    counts.set(entry.vendor, (counts.get(entry.vendor) ?? 0) + 1);

  const rows = state.ledger
    .list()
    .slice(0, 50)
    .map(
      (e) =>
        `<tr><td>${e.id}</td><td>${escapeHtml(e.at)}</td><td>${escapeHtml(e.vendor)}</td><td>${escapeHtml(`${e.method} ${e.path}`)}</td><td>${escapeHtml(e.identified?.key ?? e.identified?.kind ?? '')}</td><td>${e.status}</td></tr>`,
    )
    .join('');

  const unrecognised = state.unrecognised.length;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Vendor sandbox</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;color:#1b1b1b;background:#fff}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left}.bad{color:#b00020;font-weight:600}</style>
</head><body>
<h1>Vendor sandbox</h1>
<p>Seed <strong>${state.seed}</strong> (replay with <code>SANDBOX_SEED=${state.seed}</code>). Ports: ${Object.entries(
    ports,
  )
    .map(([name, port]) => `${escapeHtml(name)} ${port}`)
    .join(', ')}.</p>
<p>Calls: ${[...counts].map(([v, n]) => `${escapeHtml(v)} ${n}`).join(', ') || 'none yet'}.</p>
<p class="${unrecognised > 0 ? 'bad' : ''}">Unrecognised prompts: ${unrecognised}</p>
${state.agentToolFailures.length > 0 ? `<p class="bad">Agent tool failures: ${state.agentToolFailures.map((f) => escapeHtml(`${f.orchestrator} → ${f.tool}: ${f.error}`)).join('; ')}</p>` : ''}
${state.unplaced.size > 0 ? `<p>String fields with no corpus rule: ${[...state.unplaced].map(escapeHtml).join(', ')}</p>` : ''}
<table><caption>Latest 50 calls (full list: <a href="/__sandbox/ledger">/__sandbox/ledger</a>)</caption>
<thead><tr><th>#</th><th>At</th><th>Vendor</th><th>Request</th><th>Identified as</th><th>Status</th></tr></thead>
<tbody>${rows}</tbody></table>
</body></html>`;
}

export function controlHandler(
  state: SandboxState,
  ports: () => Record<string, number>,
  social?: SocialState,
  version?: SandboxVersion,
): Handler {
  return (req, res, body) => {
    const url = new URL(req.url ?? '/', 'http://sandbox.localhost');
    const method = req.method ?? 'GET';

    if (
      method === 'GET' &&
      (url.pathname === '/' || url.pathname === '/__sandbox')
    ) {
      const html = statusPage(state, ports());
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (method === 'GET' && url.pathname === '/__sandbox/ledger') {
      const since = url.searchParams.get('since');
      sendJson(res, 200, {
        seed: state.seed,
        entries: state.ledger.list({
          vendor: url.searchParams.get('vendor') ?? undefined,
          object: url.searchParams.get('object') ?? undefined,
          sinceId: since === null ? undefined : Number(since),
        }),
      });
      return;
    }

    // The source this process was started from (`src/version.ts`), which
    // apps/e2e's `sandboxRun()` compares with the tree under test.
    if (method === 'GET' && url.pathname === '/__sandbox/version' && version) {
      sendJson(res, 200, version);
      return;
    }

    if (method === 'GET' && url.pathname === '/__sandbox/state') {
      sendJson(res, 200, {
        seed: state.seed,
        quality: state.quality,
        ports: ports(),
        ledgerSize: state.ledger.size,
        prompts: state.catalog.map((p) => p.key),
        failures: state.failures,
        unrecognised: state.unrecognised,
        agentToolFailures: state.agentToolFailures,
        unplaced: [...state.unplaced],
        ...(social ? { social: social.summary() } : {}),
      });
      return;
    }

    if (method === 'POST' && url.pathname === '/__sandbox/reset') {
      const requested = (parseJson(body) as { seed?: unknown } | undefined)
        ?.seed;
      const seed =
        typeof requested === 'number' && Number.isInteger(requested)
          ? requested
          : drawSeed();
      state.reset(seed);
      social?.reset(seed);
      console.log(`[sandbox] reset; seed ${seed}`);
      sendJson(res, 200, { seed });
      return;
    }

    if (method === 'POST' && url.pathname === '/__sandbox/fail') {
      const rule = parseJson(body) as Partial<FailureRule> | undefined;
      if (
        !rule ||
        typeof rule.vendor !== 'string' ||
        typeof rule.status !== 'number' ||
        (rule.count !== undefined &&
          (!Number.isInteger(rule.count) || rule.count < 1))
      ) {
        sendJson(res, 400, {
          error:
            'expected {vendor: string, status: number, count?: positive integer, pathIncludes?: string, prompt?: string}',
        });
        return;
      }
      state.failures.push({
        vendor: rule.vendor,
        status: rule.status,
        count: rule.count ?? 1,
        ...(typeof rule.pathIncludes === 'string'
          ? { pathIncludes: rule.pathIncludes }
          : {}),
        ...(typeof rule.prompt === 'string' ? { prompt: rule.prompt } : {}),
      });
      sendJson(res, 200, { failures: state.failures });
      return;
    }

    sendJson(res, 404, {
      error: `no such control route: ${method} ${url.pathname}`,
    });
  };
}
