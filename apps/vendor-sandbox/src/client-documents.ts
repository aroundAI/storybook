import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Client metadata documents for the MCP OAuth server (FILM-1911, KB-185):
 * the copies of Claude's and ChatGPT's documents committed with the
 * studio-mcp tests, served under `/__sandbox/client-documents/<client id>`
 * when the app reads them through `VENDOR_URL_CLIENTDOCS`.
 */
const FIXTURES = resolve(
  fileURLToPath(import.meta.url),
  '../../../../packages/features/studio-mcp/__tests__/oauth/fixtures',
);

const DOCUMENTS: Record<string, string> = {
  'https://claude.ai/oauth/mcp-oauth-client-metadata':
    'claude-client-metadata.2026-10-04.json',
  'https://chatgpt.com/oauth/client.json':
    'chatgpt-client-metadata.2026-10-04.json',
};

export const CLIENT_DOCUMENTS_PATH = '/__sandbox/client-documents/';

/** The committed document for `clientId`, as served; `null` for any other. */
export function clientDocument(clientId: string): string | null {
  const file = DOCUMENTS[clientId];

  return file ? readFileSync(resolve(FIXTURES, file), 'utf8') : null;
}
