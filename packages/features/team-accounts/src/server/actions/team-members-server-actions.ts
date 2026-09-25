'use server';

import { revalidatePath } from 'next/cache';

import { createAuditLog, extractNetworkContext } from '@kit/audit-logs/server';
import { enhanceAction } from '@kit/next/actions';
import { returnRefusals } from '@kit/next/refusals';
import { createOtpApi } from '@kit/otp';
import { getLogger } from '@kit/shared/logger';
import { getSupabaseServerAdminClient } from '@kit/supabase/server-admin-client';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import { RemoveMemberSchema } from '../../schema/remove-member.schema';
import { TransferOwnershipConfirmationSchema } from '../../schema/transfer-ownership-confirmation.schema';
import { UpdateMemberRoleSchema } from '../../schema/update-member-role.schema';
import { createAccountMembersService } from '../services/account-members.service';

/**
 * @name removeMemberFromAccountAction
 * @description Removes a member from an account.
 */
const removeMemberFromAccount = enhanceAction(
  async ({ accountId, userId }, user) => {
    const client = getSupabaseServerClient();
    const service = createAccountMembersService(client);

    // Fetch account and member info before removal
    const { data: account } = await client
      .from('accounts')
      .select('name')
      .eq('id', accountId)
      .single();

    const { data: member } = await client
      .from('accounts_memberships')
      .select('account_id, user_id, account_role, created_at, updated_at')
      .eq('account_id', accountId)
      .eq('user_id', userId)
      .single();

    await service.removeMemberFromAccount({
      accountId,
      userId,
    });

    // Create audit log with network context
    if (account && member) {
      const networkContext = await extractNetworkContext();

      await createAuditLog({
        accountId,
        userId: user.id,
        action: 'delete',
        objectType: 'team_member',
        objectId: `${accountId}-${userId}`,
        objectName: `Team member in ${account.name}`,
        before: member,
        scopes: [{ type: 'account', id: accountId }],
        ...networkContext,
      });
    }

    // Note: Auth cache auto-invalidates after 5 minutes (TTL)
    // For immediate invalidation, call invalidateAuthCache(userId, accountId) from app-level code

    // revalidate all pages that depend on the account
    revalidatePath('/home/[account]', 'layout');

    return { success: true };
  },
  {
    schema: RemoveMemberSchema,
    auth: true,
  },
);

export const removeMemberFromAccountAction = returnRefusals(
  removeMemberFromAccount,
);

/**
 * @name updateMemberRoleAction
 * @description Updates the role of a member in an account.
 */
export const updateMemberRoleAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();
    const service = createAccountMembersService(client);
    const adminClient = getSupabaseServerAdminClient();

    // Fetch account and member info before update
    const { data: account } = await client
      .from('accounts')
      .select('name')
      .eq('id', data.accountId)
      .single();

    const { data: beforeMember } = await client
      .from('accounts_memberships')
      .select('account_id, user_id, account_role, created_at, updated_at')
      .eq('account_id', data.accountId)
      .eq('user_id', data.userId)
      .single();

    // update the role of the member
    await service.updateMemberRole(data, adminClient);

    // Fetch after state
    const { data: afterMember } = await client
      .from('accounts_memberships')
      .select('account_id, user_id, account_role, created_at, updated_at')
      .eq('account_id', data.accountId)
      .eq('user_id', data.userId)
      .single();

    // Create audit log with network context
    if (account && beforeMember && afterMember) {
      const networkContext = await extractNetworkContext();

      await createAuditLog({
        accountId: data.accountId,
        userId: user.id,
        action: 'permission_change',
        objectType: 'team_member',
        objectId: `${data.accountId}-${data.userId}`,
        objectName: `Team member in ${account.name}`,
        before: beforeMember,
        after: afterMember,
        scopes: [{ type: 'account', id: data.accountId }],
        ...networkContext,
      });
    }

    // Note: Auth cache auto-invalidates after 5 minutes (TTL)
    // For immediate invalidation, call invalidateAuthCache(data.userId, data.accountId) from app-level code

    // revalidate all pages that depend on the account
    revalidatePath('/home/[account]', 'layout');

    return { success: true };
  },
  {
    schema: UpdateMemberRoleSchema,
    auth: true,
  },
);

/**
 * @name transferOwnershipAction
 * @description Transfers the ownership of an account to another member.
 * Requires OTP verification for security.
 */
export const transferOwnershipAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();
    const logger = await getLogger();

    const ctx = {
      name: 'teams.transferOwnership',
      userId: user.id,
      accountId: data.accountId,
    };

    logger.info(ctx, 'Processing team ownership transfer request...');

    // assert that the user is the owner of the account
    const { data: isOwner, error } = await client.rpc('is_account_owner', {
      account_id: data.accountId,
    });

    if (error || !isOwner) {
      logger.error(ctx, 'User is not the owner of this account');

      throw new Error(
        `You must be the owner of the account to transfer ownership`,
      );
    }

    // Verify the OTP
    const otpApi = createOtpApi(client);

    const otpResult = await otpApi.verifyToken({
      token: data.otp,
      userId: user.id,
      purpose: `transfer-team-ownership-${data.accountId}`,
    });

    if (!otpResult.valid) {
      logger.error(ctx, 'Invalid OTP provided');
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

    logger.info(
      ctx,
      'OTP verification successful. Proceeding with ownership transfer...',
    );

    const service = createAccountMembersService(client);

    // at this point, the user is authenticated, is the owner of the account, and has verified via OTP
    // so we proceed with the transfer of ownership with admin privileges
    const adminClient = getSupabaseServerAdminClient();

    // Fetch account info before transfer
    const { data: account } = await client
      .from('accounts')
      .select(
        `
        id, name, slug, picture_url, email, is_personal_account,
        primary_owner_user_id, public_data, created_at, updated_at
      `,
      )
      .eq('id', data.accountId)
      .single();

    // transfer the ownership of the account
    await service.transferOwnership(data, adminClient);

    // Fetch after state
    const { data: afterAccount } = await client
      .from('accounts')
      .select(
        `
        id, name, slug, picture_url, email, is_personal_account,
        primary_owner_user_id, public_data, created_at, updated_at
      `,
      )
      .eq('id', data.accountId)
      .single();

    // Create audit log with network context
    if (account && afterAccount) {
      const networkContext = await extractNetworkContext();

      await createAuditLog({
        accountId: data.accountId,
        userId: user.id,
        action: 'permission_change',
        objectType: 'account',
        objectId: data.accountId,
        objectName: account.name,
        before: account,
        after: afterAccount,
        scopes: [{ type: 'account', id: data.accountId }],
        metadata: {
          action_type: 'ownership_transfer',
          new_owner_id: data.userId,
          previous_owner_id: user.id,
        },
        ...networkContext,
      });
    }

    // Note: Auth cache auto-invalidates after 5 minutes (TTL)
    // For immediate invalidation, call invalidateAuthCache() for both old and new owner from app-level code

    // revalidate all pages that depend on the account
    revalidatePath('/home/[account]', 'layout');

    logger.info(ctx, 'Team ownership transferred successfully');

    return {
      success: true,
    };
  },
  {
    schema: TransferOwnershipConfirmationSchema,
  },
);
