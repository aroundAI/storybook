# @kit/billing

Core billing infrastructure providing schemas, types, and services for managing subscriptions, checkouts, and billing operations across multiple payment providers.

## Purpose

This package provides the foundational billing system including:
- Billing schemas for validation (checkout, portal, subscriptions)
- Type definitions for subscriptions and orders
- Billing strategy provider for multi-provider support
- Webhook handler service for payment events
- Usage-based billing support
- Subscription lifecycle management
- Portal session creation

## Installation

```bash
pnpm add @kit/billing
```

## Core Concepts

### Billing Strategy Provider

The billing system uses a strategy pattern to support multiple payment providers:

```typescript
import { BillingStrategyProviderService } from '@kit/billing';
import { StripeStrategy } from '@kit/stripe';
import { LemonSqueezyStrategy } from '@kit/lemon-squeezy';

// Initialize provider with strategy
const billingProvider = new BillingStrategyProviderService({
  provider: process.env.BILLING_PROVIDER, // 'stripe' or 'lemon-squeezy'
  strategies: {
    stripe: new StripeStrategy(stripeConfig),
    'lemon-squeezy': new LemonSqueezyStrategy(lemonConfig)
  }
});

// Use provider-agnostic API
const checkout = await billingProvider.createCheckout({
  accountId: account.id,
  productId: 'prod_123',
  returnUrl: '/billing/success'
});
```

### Webhook Handler Service

Process payment provider webhooks consistently:

```typescript
import { BillingWebhookHandlerService } from '@kit/billing';

const webhookHandler = new BillingWebhookHandlerService({
  provider: billingProvider,
  logger
});

// Handle webhook events
export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  const body = await request.text();

  const result = await webhookHandler.handleWebhook({
    body,
    signature,
    provider: 'stripe'
  });

  if (result.processed) {
    return Response.json({ received: true });
  }

  return Response.json({ error: 'Invalid webhook' }, { status: 400 });
}
```

## Schemas

### Create Billing Checkout

```typescript
import { CreateBillingCheckoutSchema } from '@kit/billing/schema';

// Validate checkout params
const checkoutParams = CreateBillingCheckoutSchema.parse({
  accountId: 'acc_123',
  productId: 'prod_premium',
  variantId: 'var_monthly', // Optional for multi-variant products
  quantity: 1,
  returnUrl: '/billing/success',
  cancelUrl: '/billing/cancel',
  customerId: 'cus_123', // Optional existing customer
  email: 'user@example.com',
  trialDays: 14, // Optional trial period
  metadata: {
    userId: 'user_123',
    source: 'upgrade_button'
  }
});

// Create checkout session
const session = await billingProvider.createCheckout(checkoutParams);
```

### Create Portal Session

```typescript
import { CreateBillingPortalSessionSchema } from '@kit/billing/schema';

// Validate portal params
const portalParams = CreateBillingPortalSessionSchema.parse({
  customerId: 'cus_123',
  accountId: 'acc_123',
  returnUrl: '/billing'
});

// Create portal session
const portal = await billingProvider.createPortalSession(portalParams);

// Redirect user
redirect(portal.url);
```

### Update Subscription

```typescript
import { UpdateSubscriptionParamsSchema } from '@kit/billing/schema';

// Validate update params
const updateParams = UpdateSubscriptionParamsSchema.parse({
  subscriptionId: 'sub_123',
  productId: 'prod_premium_plus', // New product
  variantId: 'var_annual', // New variant
  quantity: 5, // Update quantity
  prorationBehavior: 'create_prorations'
});

// Update subscription
const updated = await billingProvider.updateSubscription(updateParams);
```

### Cancel Subscription

```typescript
import { CancelSubscriptionParamsSchema } from '@kit/billing/schema';

// Validate cancellation params
const cancelParams = CancelSubscriptionParamsSchema.parse({
  subscriptionId: 'sub_123',
  mode: 'at_period_end', // or 'immediately'
  reason: 'too_expensive',
  feedback: 'The pricing is not suitable for our needs'
});

// Cancel subscription
await billingProvider.cancelSubscription(cancelParams);
```

## Usage-Based Billing

### Report Usage

```typescript
import { ReportBillingUsageSchema } from '@kit/billing/schema';

// Validate usage report
const usageReport = ReportBillingUsageSchema.parse({
  subscriptionItemId: 'si_123',
  quantity: 1000, // API calls, storage GB, etc.
  timestamp: new Date().toISOString(),
  action: 'increment', // or 'set'
  metadata: {
    endpoint: '/api/generate',
    userId: 'user_123'
  }
});

// Report usage to provider
await billingProvider.reportUsage(usageReport);
```

### Query Usage

```typescript
import { QueryBillingUsageSchema } from '@kit/billing/schema';

// Validate usage query
const usageQuery = QueryBillingUsageSchema.parse({
  subscriptionItemId: 'si_123',
  startDate: '2024-01-01',
  endDate: '2024-01-31',
  granularity: 'day' // or 'hour', 'total'
});

// Get usage data
const usage = await billingProvider.queryUsage(usageQuery);
console.log(`Total usage: ${usage.total}`);
```

## Type Definitions

### Subscription Upsert

```typescript
import type { UpsertSubscriptionParams } from '@kit/billing/types';

const subscriptionData: UpsertSubscriptionParams = {
  subscription_id: 'sub_123',
  account_id: 'acc_123',
  customer_id: 'cus_123',
  status: 'active',
  currency: 'usd',
  interval: 'month',
  interval_count: 1,
  created_at: new Date().toISOString(),
  period_starts_at: new Date().toISOString(),
  period_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  line_items: [
    {
      id: 'li_123',
      quantity: 1,
      subscription_id: 'sub_123',
      subscription_item_id: 'si_123',
      product_id: 'prod_123',
      variant_id: 'var_123',
      price_amount: 2999, // $29.99 in cents
      interval: 'month',
      interval_count: 1,
      type: 'flat'
    }
  ]
};

// Upsert to database
await supabase.rpc('upsert_subscription', subscriptionData);
```

### Order Upsert

```typescript
import type { UpsertOrderParams } from '@kit/billing/types';

const orderData: UpsertOrderParams = {
  order_id: 'order_123',
  account_id: 'acc_123',
  customer_id: 'cus_123',
  status: 'completed',
  currency: 'usd',
  total_amount: 9999, // $99.99 in cents
  billing_provider: 'stripe',
  created_at: new Date().toISOString()
};

// Upsert to database
await supabase.rpc('upsert_order', orderData);
```

## Creating Custom Billing Schema

```typescript
import { createBillingSchema } from '@kit/billing';
import { z } from 'zod';

// Define your product configuration
const config = {
  products: [
    {
      id: 'prod_starter',
      name: 'Starter',
      currency: 'USD',
      price: 9.99,
      interval: 'month' as const,
      features: ['Basic features', '10 projects']
    },
    {
      id: 'prod_pro',
      name: 'Pro',
      currency: 'USD',
      price: 29.99,
      interval: 'month' as const,
      features: ['All features', 'Unlimited projects']
    }
  ],
  features: {
    maxProjects: z.number(),
    maxTeamMembers: z.number(),
    advancedAnalytics: z.boolean()
  }
};

// Create billing schema with your config
const BillingSchema = createBillingSchema(config);

// Use generated types
type Product = z.infer<typeof BillingSchema.ProductSchema>;
type Features = z.infer<typeof BillingSchema.FeaturesSchema>;
```

## Webhook Event Handling

### Event Types

```typescript
// Common webhook events to handle
type BillingWebhookEvent =
  | 'checkout.session.completed'
  | 'customer.subscription.created'
  | 'customer.subscription.updated'
  | 'customer.subscription.deleted'
  | 'invoice.payment_succeeded'
  | 'invoice.payment_failed'
  | 'customer.updated'
  | 'payment_method.attached';

// Handle events
async function handleWebhookEvent(event: BillingWebhookEvent, data: any) {
  switch (event) {
    case 'checkout.session.completed':
      await handleCheckoutComplete(data);
      break;

    case 'customer.subscription.updated':
      await handleSubscriptionUpdate(data);
      break;

    case 'invoice.payment_failed':
      await handlePaymentFailure(data);
      break;
  }
}
```

## Error Handling

```typescript
import { getLogger } from '@kit/shared/logger';

async function safeBillingOperation() {
  const logger = await getLogger();

  try {
    const session = await billingProvider.createCheckout({
      accountId: account.id,
      productId: 'prod_123'
    });

    return session;
  } catch (error) {
    logger.error(
      { error, accountId: account.id },
      'Failed to create checkout session'
    );

    // Handle specific billing errors
    if (error.code === 'INVALID_PRODUCT') {
      throw new Error('Selected product is not available');
    }

    if (error.code === 'CUSTOMER_NOT_FOUND') {
      throw new Error('Customer account not found');
    }

    throw error;
  }
}
```

## Testing

```typescript
import { createMockBillingProvider } from '@kit/billing/testing';

describe('Billing Operations', () => {
  let provider: MockBillingProvider;

  beforeEach(() => {
    provider = createMockBillingProvider({
      checkouts: [],
      subscriptions: [],
      customers: []
    });
  });

  it('should create checkout session', async () => {
    const session = await provider.createCheckout({
      accountId: 'acc_123',
      productId: 'prod_123'
    });

    expect(session.url).toBeDefined();
    expect(session.id).toBeDefined();
  });

  it('should handle webhook', async () => {
    const result = await provider.handleWebhook({
      event: 'checkout.session.completed',
      data: { session_id: 'cs_123' }
    });

    expect(result.processed).toBe(true);
  });
});
```

## Best Practices

1. **Always validate with schemas** - Use provided schemas for all billing operations
2. **Handle webhooks idempotently** - Store and check event IDs to prevent duplicates
3. **Log all billing events** - Maintain audit trail for financial operations
4. **Use metadata fields** - Track important context in provider metadata
5. **Implement retry logic** - Handle transient failures gracefully
6. **Secure webhook endpoints** - Verify signatures and use HTTPS
7. **Test webhook handlers** - Use provider testing tools
8. **Monitor failed payments** - Set up alerts for payment failures
9. **Implement grace periods** - Allow time for payment retry
10. **Keep customer data synced** - Update local records on webhook events

## Package Dependencies

### External
- `zod`: Schema validation

### Internal
- `@kit/supabase`: Database types and operations

### Packages that use this:
- [web](../../../apps/web)
- [@kit/billing-gateway](../gateway)
- [@kit/lemon-squeezy](../lemon-squeezy)
- [@kit/stripe](../stripe)
- [@kit/database-webhooks](../../database-webhooks)

## Contributing

When making changes to this package:

1. Maintain provider-agnostic interfaces
2. Update schemas for new billing features
3. Test with multiple payment providers
4. Run `pnpm typecheck` before committing
5. Document new billing operations

---

*Updated on 9/20/2025*