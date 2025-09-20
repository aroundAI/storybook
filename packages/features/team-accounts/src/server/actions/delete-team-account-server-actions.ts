'use server';

import { redirect } from 'next/navigation';

import type { SupabaseClient } from '@supabase/supabase-js';

import { enhanceAction } from '@kit/next/actions';
import { createOtpApi } from '@kit/otp';
import { getLogger } from '@kit/shared/logger';
import type { Database } from '@kit/supabase/database';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { DeleteTeamAccountSchema } from '../../schema/delete-team-account.schema';
import { createDeleteTeamAccountService } from '../services/delete-team-account.service';

const enableTeamAccountDeletion =
  process.env.NEXT_PUBLIC_ENABLE_TEAM_ACCOUNTS_DELETION === 'true';

export const deleteTeamAccountAction = enhanceAction(
  async (formData: FormData, user) => {
    const logger = await getLogger();

    const params = DeleteTeamAccountSchema.parse(
      Object.fromEntries(formData.entries()),
    );

    const otpService = createOtpApi(getSupabaseServerClient());

    const otpResult = await otpService.verifyToken({
      purpose: `delete-team-account-${params.accountId}`,
      userId: user.id,
      token: params.otp,
    });

    if (!otpResult.valid) {
      throw new Error('Invalid OTP code');
    }

    const ctx = {
      name: 'team-accounts.delete',
      userId: user.id,
      accountId: params.accountId,
    };

    if (!enableTeamAccountDeletion) {
      logger.warn(ctx, `Team account deletion is not enabled`);

      throw new Error('Team account deletion is not enabled');
    }

    logger.info(ctx, `Deleting team account...`);

    await deleteTeamAccount({
      accountId: params.accountId,
      userId: user.id,
    });

    logger.info(ctx, `Team account request successfully sent`);

    return redirect('/home');
  },
  {
    auth: true,
  },
);

async function deleteTeamAccount(params: {
  accountId: string;
  userId: string;
}) {
  const client = getSupabaseServerClient();
  const service = createDeleteTeamAccountService();

  // verify that the user has the necessary permissions to delete the team account
  await assertUserPermissionsToDeleteTeamAccount(client, params.accountId);

  // delete the team account
  await service.deleteTeamAccount(client, params);
}

async function assertUserPermissionsToDeleteTeamAccount(
  client: SupabaseClient<Database>,
  accountId: string,
) {
  const { data: isOwner, error } = await client
    .rpc('is_account_owner', {
      account_id: accountId,
    })
    .single();

  if (error || !isOwner) {
    throw new Error('You do not have permission to delete this account');
  }

  return isOwner;
}
