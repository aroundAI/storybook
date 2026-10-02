import type { OAuthErrorCode } from '@kit/studio-mcp/server';
import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';

/**
 * A request we could not trust: unknown client, or a redirect URI it did
 * not register. Shown here and nowhere else; the user agent is never sent
 * to an unverified URI (FILM-1907, EDD threats: open redirect).
 */
export function AuthorizeError(props: {
  code: OAuthErrorCode;
  description: string;
}) {
  return (
    <Alert variant="destructive" data-test="oauth-authorize-error">
      <AlertTitle>This connection request cannot be completed</AlertTitle>
      <AlertDescription className="space-y-2">
        <p data-test="oauth-authorize-error-description">{props.description}</p>
        <p className="text-xs">
          Error code <code>{props.code}</code>. Go back to the app that sent you
          here and try adding StoryBook again.
        </p>
      </AlertDescription>
    </Alert>
  );
}
