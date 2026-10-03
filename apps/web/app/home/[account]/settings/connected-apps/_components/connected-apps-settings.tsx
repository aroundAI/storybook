import type { McpConnectionSummary } from '@kit/studio-mcp';

import { AddToClaudeCard } from './add-to-claude-card';
import { CreatePersonalAccessTokenForm } from './create-personal-access-token-form';
import { McpConnectionsList } from './mcp-connections-list';

/**
 * Settings → Connected apps (FILM-1904). Composed of small sections so
 * FILM-1907 can add the OAuth connections and the "Add to Claude" guidance
 * beside these without touching them.
 */
export function ConnectedAppsSettings(props: {
  accountSlug: string;
  connections: McpConnectionSummary[];
}) {
  return (
    <div className="space-y-8" data-test="connected-apps-settings">
      <McpConnectionsList
        accountSlug={props.accountSlug}
        connections={props.connections}
      />

      <AddToClaudeCard />

      <CreatePersonalAccessTokenForm accountSlug={props.accountSlug} />
    </div>
  );
}
