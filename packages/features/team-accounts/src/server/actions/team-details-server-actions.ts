'use server';

import { redirect } from 'next/navigation';

import { createAuditLog } from '@kit/audit-logs/server';
import { enhanceAction } from '@kit/next/actions';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { UpdateTeamNameSchema } from '../../schema/update-team-name.schema';

export const updateTeamAccountName = enhanceAction(
  async (params, user) => {
    const client = getSupabaseServerClient();
    const logger = await getLogger();
    const { name, path, slug } = params;

    const ctx = {
      name: 'team-accounts.update',
      accountName: name,
    };

    logger.info(ctx, `Updating team name...`);

    // Fetch before state for audit log
    const { data: beforeAccount } = await client
      .from('accounts')
      .select('*')
      .eq('slug', slug)
      .single();

    const { error, data } = await client
      .from('accounts')
      .update({
        name,
        slug,
      })
      .match({
        slug,
      })
      .select('*')
      .single();

    if (error) {
      logger.error({ ...ctx, error }, `Failed to update team name`);

      throw error;
    }

    const newSlug = data.slug;

    logger.info(ctx, `Team name updated`);

    // Create audit log
    if (beforeAccount) {
      await createAuditLog({
        accountId: data.id,
        userId: user.id,
        action: 'update',
        objectType: 'account',
        objectId: data.id,
        objectName: data.name,
        before: beforeAccount,
        after: data,
        scopes: [{ type: 'account', id: data.id }],
      });
    }

    if (newSlug) {
      const nextPath = path.replace('[account]', newSlug);

      redirect(nextPath);
    }

    return { success: true };
  },
  {
    schema: UpdateTeamNameSchema,
    auth: true,
  },
);
