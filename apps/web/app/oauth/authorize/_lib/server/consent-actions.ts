'use server';

import 'server-only';

import { isDesktopIntegrationEnabled } from '@kit/desktop-integration/server';
import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import { requiresDesktopIntegration } from '@kit/studio-mcp/desktop-client';
import {
  OAuthError,
  denialLocation,
  issueAuthorizationCode,
  parseAuthorizeRequest,
} from '@kit/studio-mcp/server';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { oauthDeps } from '../../../_lib/server/oauth-route';
import {
  ApproveConsentSchema,
  DenyConsentSchema,
} from '../schemas/consent.schema';

const DESKTOP_INTEGRATION_OFF =
  'StorybookStudio is turned off for that team. A team owner turns it on in Settings → AI.';

const STALE =
  'This authorization request is no longer valid. Start again from your MCP client.';

/**
 * The user approved: re-validate the request, check they belong to the
 * team they chose, mint a single-use code and send them back to the client
 * (FILM-1907). The redirect is returned, not performed: a server action's
 * redirect cannot reach a custom scheme or another origin, so the form
 * navigates.
 */
export const approveConsentAction = returnRefusals(
  enhanceAction(
    async (data, user) => {
      const deps = oauthDeps();
      const parsed = await parseAuthorizeRequest(
        new URLSearchParams(data.query),
        deps,
      );

      if (!parsed.ok) {
        throw new ActionRefusal(STALE);
      }

      const client = getSupabaseServerClient();
      const { data: member, error } = await client.rpc('has_role_on_account', {
        account_id: data.accountId,
      });

      if (error) {
        throw new Error(`membership check failed: ${error.message}`);
      }

      if (member !== true) {
        throw new ActionRefusal('You are not a member of that team.');
      }

      if (
        requiresDesktopIntegration(parsed.request.client.clientId) &&
        !(await isDesktopIntegrationEnabled(client, data.accountId))
      ) {
        throw new ActionRefusal(DESKTOP_INTEGRATION_OFF);
      }

      try {
        const { location } = await issueAuthorizationCode(deps.store, {
          request: parsed.request,
          userId: user.id,
          accountId: data.accountId,
          scopes: data.scopes,
        });

        return { redirectTo: location };
      } catch (cause) {
        if (cause instanceof OAuthError) {
          throw new ActionRefusal(cause.message);
        }

        throw cause;
      }
    },
    { schema: ApproveConsentSchema, auth: true },
  ),
);

/** The user declined: the client is told, with the state it sent. */
export const denyConsentAction = returnRefusals(
  enhanceAction(
    async (data) => {
      const parsed = await parseAuthorizeRequest(
        new URLSearchParams(data.query),
        oauthDeps(),
      );

      if (!parsed.ok) {
        throw new ActionRefusal(STALE);
      }

      return { redirectTo: denialLocation(parsed.request) };
    },
    { schema: DenyConsentSchema, auth: true },
  ),
);
