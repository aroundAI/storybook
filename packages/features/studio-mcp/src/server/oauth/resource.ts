/**
 * The MCP resource URL (RFC 8707 resource indicator): what every access
 * token is bound to and what the protected-resource metadata names as
 * `resource`. Comparison is on the canonical form so `.../api/mcp` and
 * `.../api/mcp/` are one resource and a host's case does not matter.
 */
export const MCP_RESOURCE_PATH = '/api/mcp';

export function mcpResourceUrl(siteOrigin: string) {
  return `${new URL(siteOrigin).origin}${MCP_RESOURCE_PATH}`;
}

export function canonicalResource(value: string): string | null {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.hash || url.search) return null;

  const path = url.pathname.replace(/\/+$/, '');

  return `${url.origin.toLowerCase()}${path}`;
}

export function resourceMatches(requested: string, configured: string) {
  const a = canonicalResource(requested);
  const b = canonicalResource(configured);

  return a !== null && b !== null && a === b;
}
