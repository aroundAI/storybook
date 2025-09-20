import 'server-only';

import { z } from 'zod';

import {
  type BillingProviderSchema,
  BillingStrategyProviderService,
} from '@kit/billing';
import { createRegistry } from '@kit/shared/registry';

// Create a registry for billing strategy providers
export const billingStrategyRegistry = createRegistry<
  BillingStrategyProviderService,
  z.infer<typeof BillingProviderSchema>
>();

// Register the Stripe billing strategy
billingStrategyRegistry.register('stripe', async () => {
  const { StripeBillingStrategyService } = await import('@kit/stripe');
  return new StripeBillingStrategyService();
});

// Register the Lemon Squeezy billing strategy
billingStrategyRegistry.register('lemon-squeezy', async () => {
  const { LemonSqueezyBillingStrategyService } = await import(
    '@kit/lemon-squeezy'
  );
  return new LemonSqueezyBillingStrategyService();
});

// Register Paddle billing strategy (not implemented yet)
billingStrategyRegistry.register('paddle', () => {
  throw new Error('Paddle is not supported yet');
});
