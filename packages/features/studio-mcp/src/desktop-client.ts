/**
 * StorybookStudio, the desktop editor, as an OAuth client (FILM-2005). It is
 * pre-registered: a migration seeds its `mcp_oauth_clients` row, so no
 * install registers itself. Two things set it apart from every other
 * client, both keyed on this id alone:
 *
 * - `/oauth/authorize` also accepts a loopback redirect on any port
 *   (`http://127.0.0.1:<port>/callback`, RFC 8252 §7.3), the fallback for
 *   a machine where the `storybookstudio://` handler is missing;
 * - consent needs the team's `account_ai_settings.desktop_integration_enabled`.
 *
 * Client-safe: the connected-apps list labels its connections with it.
 */
export const STORYBOOKSTUDIO_CLIENT_ID = 'storybookstudio';
export const STORYBOOKSTUDIO_CLIENT_NAME = 'StorybookStudio';

/** The client's custom-scheme redirect, seeded with the client row. */
export const STORYBOOKSTUDIO_REDIRECT_URI = 'storybookstudio://auth/callback';

/** Whether a grant to this client needs the team's desktop integration on. */
export function requiresDesktopIntegration(clientId: string) {
  return clientId === STORYBOOKSTUDIO_CLIENT_ID;
}
