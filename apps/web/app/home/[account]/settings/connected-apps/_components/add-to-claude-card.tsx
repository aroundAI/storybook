import { mcpResourceFromEnv } from '@kit/studio-mcp/server';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';

/**
 * How to connect by URL (FILM-1907, FILM-1911): Claude and ChatGPT both
 * discover our OAuth server from the connector URL, send the user here to
 * sign in and consent, and the grant appears in the list above as an OAuth
 * app. A server component: the URL comes from the server's own
 * configuration.
 */
export function AddToClaudeCard() {
  const connectorUrl = mcpResourceFromEnv();

  return (
    <Card data-test="add-to-claude-card">
      <CardHeader>
        <CardTitle>Add StoryBook to Claude or ChatGPT</CardTitle>
        <CardDescription>
          No token to copy: the app sends you here to sign in and choose a team.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>
          Connector URL:{' '}
          <code
            className="rounded bg-muted px-2 py-0.5 font-mono text-xs break-all"
            data-test="mcp-connector-url"
          >
            {connectorUrl}
          </code>
        </p>
        <div data-test="add-to-claude-steps">
          <p className="font-medium">Claude</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Open <strong>Customize → Connectors</strong> and click{' '}
              <strong>Add custom connector</strong>.
            </li>
            <li>Paste the connector URL and click Add.</li>
          </ol>
        </div>
        <div data-test="add-to-chatgpt-steps">
          <p className="font-medium">
            ChatGPT (Plus, Pro, Business, Enterprise or Edu)
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>
              Turn on{' '}
              <strong>Settings → Security and login → Developer mode</strong>.
            </li>
            <li>
              Create an app for a remote MCP server, paste the connector URL and
              choose OAuth.
            </li>
          </ol>
        </div>
        <p>
          Then sign in when asked, pick the team the app may work in, and choose
          what it may do.
        </p>
        <p className="text-muted-foreground">
          The connection is listed above as an OAuth app. Revoke it there to
          sign the app out of this team; a password change revokes every
          connection.
        </p>
      </CardContent>
    </Card>
  );
}
