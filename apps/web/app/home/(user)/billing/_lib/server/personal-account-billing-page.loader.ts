import 'server-only';

import { cache } from 'react';

import { createAccountsApi } from '@kit/accounts/api';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * Load the personal account billing page data for the given user.
 * @param userId
 * @returns The subscription data or the orders data and the billing customer ID.
 * This function is cached per-request.
 */
export const loadPersonalAccountBillingPageData = cache(
  personalAccountBillingPageDataLoader,
);

function personalAccountBillingPageDataLoader(userId: string) {
  const client = getSupabaseServerClient();
  const api = createAccountsApi(client);

  const subscription = api.getSubscription(userId);
  const order = api.getOrder(userId);
  const customerId = api.getCustomerId(userId);

  return Promise.all([subscription, order, customerId]);
}
