'use server';

import 'server-only';

import { revalidatePath } from 'next/cache';

import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import { whyNoRow } from '@kit/shared/rows';
import {
  createPersonalAccessToken,
  revokeMcpConnection,
} from '@kit/studio-mcp/server';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  CreatePersonalAccessTokenSchema,
  RevokeMcpConnectionSchema,
} from '../schemas/connected-apps.schema';

async function accountIdFromSlug(slug: string) {
  const client = getSupabaseServerClient();
  const { data, error } = await client
    .from('accounts')
    .select('id')
    .eq('slug', slug)
    .single();

  if (error || !data) {
    throw new Error(whyNoRow(error, 'Account not found'));
  }

  return data.id;
}

/**
 * Mints a personal access token for the signed-in user on this team. The
 * plaintext is in the result once; only its hash is stored (FILM-1904).
 */
export const createPersonalAccessTokenAction = returnRefusals(
  enhanceAction(
    async (data) => {
      const client = getSupabaseServerClient();
      const accountId = await accountIdFromSlug(data.accountSlug);

      const result = await createPersonalAccessToken(client, {
        accountId,
        name: data.name,
        scopes: data.scopes,
      });

      if (!result.ok) {
        if (result.error.code === '42501') {
          throw new ActionRefusal(
            'Only members of this team can create a token for it.',
          );
        }

        throw new Error(
          `Could not create the token (${result.error.code}): ${result.error.message}`,
        );
      }

      revalidatePath(`/home/${data.accountSlug}/settings/connected-apps`);

      return { token: result.token, connection: result.connection };
    },
    { schema: CreatePersonalAccessTokenSchema, auth: true },
  ),
);

/**
 * Revokes one of the signed-in user's connections. Every token it holds is
 * refused from the next call on.
 */
export const revokeMcpConnectionAction = returnRefusals(
  enhanceAction(
    async (data) => {
      const client = getSupabaseServerClient();
      const changed = await revokeMcpConnection(client, data.connectionId);

      if (changed === 0) {
        throw new ActionRefusal(
          'That connection is not yours, or was already revoked.',
        );
      }

      revalidatePath(`/home/${data.accountSlug}/settings/connected-apps`);

      return { revoked: true };
    },
    { schema: RevokeMcpConnectionSchema, auth: true },
  ),
);
