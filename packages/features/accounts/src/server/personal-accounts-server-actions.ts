'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  createAuditLog,
  extractNetworkContext,
} from '@kit/audit-logs/server';
import { enhanceAction } from '@kit/next/actions';
import { createOtpApi } from '@kit/otp';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { DeletePersonalAccountSchema } from '../schema/delete-personal-account.schema';
import { createDeletePersonalAccountService } from './services/delete-personal-account.service';

const enableAccountDeletion =
  process.env.NEXT_PUBLIC_ENABLE_PERSONAL_ACCOUNT_DELETION === 'true';

export async function refreshAuthSession() {
  const client = getSupabaseServerClient();

  await client.auth.refreshSession();

  return {};
}

export const deletePersonalAccountAction = enhanceAction(
  async (formData: FormData, user) => {
    const logger = await getLogger();

    // validate the form data
    const { success } = DeletePersonalAccountSchema.safeParse(
      Object.fromEntries(formData.entries()),
    );

    if (!success) {
      throw new Error('Invalid form data');
    }

    const ctx = {
      name: 'account.delete',
      userId: user.id,
    };

    const otp = formData.get('otp') as string;

    if (!otp) {
      throw new Error('OTP is required');
    }

    if (!enableAccountDeletion) {
      logger.warn(ctx, `Account deletion is not enabled`);

      throw new Error('Account deletion is not enabled');
    }

    logger.info(ctx, `Deleting account...`);

    // verify the OTP
    const client = getSupabaseServerClient();
    const otpApi = createOtpApi(client);

    const otpResult = await otpApi.verifyToken({
      token: otp,
      userId: user.id,
      purpose: 'delete-personal-account',
    });

    if (!otpResult.valid) {
      throw new Error('Invalid OTP');
    }

    // validate the user ID matches the nonce's user ID
    if (otpResult.user_id !== user.id) {
      logger.error(
        ctx,
        `This token was meant to be used by a different user. Exiting.`,
      );

      throw new Error('Nonce mismatch');
    }

    // Fetch account info before deletion for audit log
    const { data: account } = await client
      .from('accounts')
      .select('*')
      .eq('id', user.id)
      .eq('is_personal_account', true)
      .single();

    // create a new instance of the personal accounts service
    const service = createDeletePersonalAccountService();

    // delete the user's account and cancel all subscriptions
    await service.deletePersonalAccount({
      adminClient: getSupabaseServerAdminClient(),
      userId: user.id,
      userEmail: user.email ?? null,
    });

    // Create audit log before signing out (with network context)
    if (account) {
      const networkContext = await extractNetworkContext();

      await createAuditLog({
        accountId: account.id,
        userId: user.id,
        action: 'delete',
        objectType: 'account',
        objectId: account.id,
        objectName: account.name,
        before: account,
        scopes: [{ type: 'account', id: account.id }],
        ...networkContext,
      });
    }

    // sign out the user after deleting their account
    await client.auth.signOut();

    logger.info(ctx, `Account request successfully sent`);

    // clear the cache for all pages
    revalidatePath('/', 'layout');

    // redirect to the home page
    redirect('/');
  },
  {},
);
