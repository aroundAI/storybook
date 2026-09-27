import type http from 'node:http';

/**
 * What every sandboxed consent screen shares (FILM-1802 §3: "a user can
 * connect … through the real connect and callback routes"). The app sends
 * the browser to the vendor's authorize URL; this page stands in for the
 * vendor's consent screen, names the account and the scopes asked for, and
 * lets the person untick any of them — which is how "a missing scope returns
 * the vendor's authorisation error" is reached through the real flow.
 */

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export interface ConsentPage {
  vendor: string;
  accountName: string;
  accountHandle: string;
  scopes: string[];
  /** Where the form posts its decision (a sandbox path on the same origin). */
  action: string;
  /** Carried through the decision untouched: client, redirect, state, … */
  hidden: Record<string, string>;
}

export function consentPage(page: ConsentPage) {
  const hidden = Object.entries(page.hidden)
    .map(
      ([name, value]) =>
        `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(value)}">`,
    )
    .join('');
  const scopes = page.scopes
    .map(
      (scope) =>
        `<li><label><input type="checkbox" name="scope" value="${escapeHtml(scope)}" checked data-test="sandbox-scope"> ${escapeHtml(scope)}</label></li>`,
    )
    .join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(page.vendor)} — vendor sandbox</title>
<style>body{font:15px system-ui,sans-serif;margin:0;background:#f4f5f7;color:#1b1b1b}main{max-width:460px;margin:48px auto;background:#fff;border:1px solid #d9dbe0;border-radius:10px;padding:28px}h1{font-size:20px;margin:0 0 4px}.who{color:#555;margin:0 0 18px}.note{font-size:12px;color:#8a4b00;background:#fff4e0;border-radius:6px;padding:8px 10px;margin-bottom:18px}ul{list-style:none;padding:0;margin:0 0 20px}li{padding:6px 0;border-bottom:1px solid #eee;word-break:break-all}.actions{display:flex;gap:10px;justify-content:flex-end}button{font:inherit;padding:8px 18px;border-radius:6px;border:1px solid #bbb;background:#fff;cursor:pointer}button.allow{background:#1a73e8;border-color:#1a73e8;color:#fff}</style>
</head><body><main>
<div class="note">Vendor sandbox on this machine. Nothing here reaches ${escapeHtml(page.vendor)}.</div>
<h1>${escapeHtml(page.vendor)} wants to connect your account</h1>
<p class="who" data-test="sandbox-consent-account">Signed in as <strong>${escapeHtml(page.accountName)}</strong> (@${escapeHtml(page.accountHandle)})</p>
<form method="post" action="${escapeHtml(page.action)}">${hidden}
<p>Grant access to:</p>
<ul>${scopes}</ul>
<div class="actions">
<button type="submit" name="decision" value="deny" data-test="sandbox-consent-deny">Cancel</button>
<button type="submit" name="decision" value="allow" class="allow" data-test="sandbox-consent-allow">Allow</button>
</div>
</form>
</main></body></html>`;
}

export function sendHtml(res: http.ServerResponse, status: number, html: string) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
  });
  res.end(html);
}

export function redirect(res: http.ServerResponse, location: string) {
  res.writeHead(302, { location, 'content-length': 0 });
  res.end();
}

/** A form body (`application/x-www-form-urlencoded`). */
export function formOf(body: Buffer) {
  return new URLSearchParams(body.toString('utf8'));
}

/** A URL with query parameters added, keeping any it already has. */
export function withParams(base: string, params: Record<string, string>) {
  const url = new URL(base);
  for (const [name, value] of Object.entries(params))
    url.searchParams.set(name, value);
  return url.toString();
}

/** The bearer token of a request, if any. */
export function bearerOf(req: http.IncomingMessage) {
  const header = req.headers.authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? null;
}
