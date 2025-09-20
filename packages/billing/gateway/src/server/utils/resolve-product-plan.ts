import { z } from 'zod';

import {
  BillingConfig,
  LineItemSchema,
  PlanSchema,
  type ProductSchema,
  getProductPlanPairByVariantId,
} from '@kit/billing';
import { getBillingGatewayProvider } from '@kit/billing-gateway';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

/**
 * @name resolveProductPlan
 * @description
 * Tries to find a product and plan in the local billing config.
 * Falls back to fetching the plan details from the billing provider if missing.
 */
export async function resolveProductPlan(
  config: BillingConfig,
  variantId: string,
  currency: string,
): Promise<{
  product: ProductSchema;
  plan: z.infer<typeof PlanSchema>;
}> {
  // we can't always guarantee that the plan will be present in the local config
  // so we need to fallback to fetching the plan details from the billing provider
  try {
    // attempt to get the plan details from the local config
    return getProductPlanPairByVariantId(config, variantId);
  } catch {
    // retrieve the plan details from the billing provider
    return fetchPlanDetailsFromProvider({ variantId, currency });
  }
}

/**
 * @name fetchPlanDetailsFromProvider
 * @description
 * Fetches the plan details from the billing provider
 * @param variantId - The variant ID of the plan
 * @param currency - The currency of the plan
 * @returns The product and plan objects
 */
async function fetchPlanDetailsFromProvider({
  variantId,
  currency,
}: {
  variantId: string;
  currency: string;
}) {
  const client = getSupabaseServerClient();
  const gateway = await getBillingGatewayProvider(client);

  const providerPlan = await gateway.getPlanById(variantId);

  const plan = PlanSchema.parse({
    id: providerPlan.id,
    name: providerPlan.name,
    description: providerPlan.description ?? providerPlan.name,
    interval: providerPlan.interval as 'month' | 'year' | undefined,
    paymentType: providerPlan.type,
    lineItems: [
      LineItemSchema.parse({
        id: providerPlan.id,
        name: providerPlan.name,
        cost: providerPlan.amount,
        // support only flat plans - tiered plans are not supported
        // however, users can clarify the plan details in the description
        type: 'flat',
      }),
    ],
  });

  // create a minimal product and plan object so we can
  // display the plan details in the UI
  const product: ProductSchema = {
    id: providerPlan.id,
    name: providerPlan.name,
    description: providerPlan.description ?? '',
    currency,
    features: [''],
    plans: [],
  };

  return { product, plan };
}
