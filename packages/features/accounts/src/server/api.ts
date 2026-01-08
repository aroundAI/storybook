import { SupabaseClient } from '@supabase/supabase-js';

import { Database } from '@kit/supabase/database';

/**
 * Class representing an API for interacting with user accounts.
 * @constructor
 * @param {SupabaseClient<Database>} client - The Supabase client instance.
 */
class AccountsApi {
  constructor(private readonly client: SupabaseClient<Database>) { }

  /**
   * @name getAccount
   * @description Get the account data for the given ID.
   * @param id
   */
  async getAccount(id: string) {
    const { data, error } = await this.client
      .from('accounts')
      .select(`
        id, name, slug, picture_url, email, is_personal_account,
        primary_owner_user_id, public_data, created_at, updated_at
      `)
      .eq('id', id)
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  /**
   * @name getAccountWorkspace
   * @description Get the account workspace data.
   */
  async getAccountWorkspace() {
    const { data, error } = await this.client
      .from('user_account_workspace')
      .select(`*`)
      .single();

    if (error) {
      throw error;
    }

    return data;
  }

  /**
   * @name loadUserAccounts
   * Load the user accounts.
   */
  async loadUserAccounts() {
    const { data: accounts, error } = await this.client
      .from('user_accounts')
      .select(`name, slug, picture_url`);

    if (error) {
      throw error;
    }

    return accounts.map(({ name, slug, picture_url }) => {
      return {
        label: name,
        value: slug,
        image: picture_url,
      };
    });
  }

  /**
   * @name getSubscription
   * Get the subscription data for the given user.
   * @param accountId
   */
  async getSubscription(accountId: string) {
    const response = await this.client
      .from('subscriptions')
      .select(`
        id, account_id, billing_customer_id, billing_provider, status, active,
        period_starts_at, period_ends_at, trial_starts_at, trial_ends_at, currency,
        cancel_at_period_end, created_at, updated_at,
        items: subscription_items !inner (
          id, subscription_id, product_id, variant_id, price_amount,
          quantity, interval, interval_count, type, created_at, updated_at
        )
      `)
      .eq('account_id', accountId)
      .maybeSingle();

    if (response.error) {
      throw response.error;
    }

    return response.data;
  }

  /**
   * Get the orders data for the given account.
   * @param accountId
   */
  async getOrder(accountId: string) {
    const response = await this.client
      .from('orders')
      .select(`
        id, account_id, billing_customer_id, billing_provider, status,
        currency, total_amount, created_at, updated_at,
        items: order_items !inner (
          id, order_id, product_id, variant_id, price_amount,
          quantity, created_at, updated_at
        )
      `)
      .eq('account_id', accountId)
      .maybeSingle();

    if (response.error) {
      throw response.error;
    }

    return response.data;
  }

  /**
   * @name getCustomerId
   * Get the billing customer ID for the given user.
   * If the user does not have a billing customer ID, it will return null.
   * @param accountId
   */
  async getCustomerId(accountId: string) {
    const response = await this.client
      .from('billing_customers')
      .select('customer_id')
      .eq('account_id', accountId)
      .maybeSingle();

    if (response.error) {
      throw response.error;
    }

    return response.data?.customer_id;
  }
}

export function createAccountsApi(client: SupabaseClient<Database>) {
  return new AccountsApi(client);
}
