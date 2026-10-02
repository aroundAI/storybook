import { mcpResourceFromEnv } from '@kit/studio-mcp/server';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';

/**
 * How to connect by URL (FILM-1907): Claude discovers our OAuth server from
 * the connector URL, sends the user to sign in and consent, and the grant
 * appears in the list above as an OAuth app. A server component: the URL
 * comes from the server's own configuration.
 */
export function AddToClaudeCard() {
  const connectorUrl = mcpResourceFromEnv();

  return (
    <Card data-test="add-to-claude-card">
      <CardHeader>
        <CardTitle>Add StoryBook to Claude</CardTitle>
        <CardDescription>
          No token to copy: Claude sends you here to sign in and choose a team.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            In Claude, open <strong>Settings → Connectors → Add custom
            connector</strong>.
          </li>
          <li>
            Paste this URL:{' '}
            <code
              className="rounded bg-muted px-2 py-0.5 font-mono text-xs break-all"
              data-test="mcp-connector-url"
            >
              {connectorUrl}
            </code>
          </li>
          <li>
            Sign in when asked, pick the team Claude may work in, and choose
            what it may do.
          </li>
        </ol>
        <p className="text-muted-foreground">
          The connection is listed above as an OAuth app. Revoke it there to
          sign Claude out of this team; a password change revokes every
          connection.
        </p>
      </CardContent>
    </Card>
  );
}
