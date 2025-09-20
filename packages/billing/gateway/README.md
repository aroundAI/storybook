# @kit/billing-gateway

Unified payment gateway that abstracts multiple payment providers (Stripe, LemonSqueezy) behind a single interface.

## Purpose

This package provides a unified billing interface that allows you to switch between payment providers without changing your application code. It handles subscriptions, checkout sessions, customer portals, webhooks, and billing management for both Stripe and LemonSqueezy.

## Configuration

Set your billing provider in environment variables:

```env
# Choose your provider: 'stripe' or 'lemonsqueezy'
BILLING_PROVIDER=stripe

# Provider-specific keys
STRIPE_SECRET_KEY=sk_...
STRIPE_PUBLISHABLE_KEY=pk_...
STRIPE_WEBHOOK_SECRET=whsec_...

# OR for LemonSqueezy
LEMONSQUEEZY_API_KEY=...
LEMONSQUEEZY_STORE_ID=...
LEMONSQUEEZY_WEBHOOK_SECRET=...
```

## Public API

### Initialize Billing Gateway

```typescript
import { createBillingGateway } from '@kit/billing-gateway';

// Automatically uses the configured provider
const billing = createBillingGateway();
```

### Create Checkout Session

```typescript
import { createCheckoutSession } from '@kit/billing-gateway';

// For subscription checkout
const session = await createCheckoutSession({
  accountId: 'account-123',
  priceId: 'price_abc123', // Provider-specific price ID
  customerId: 'cus_123', // Optional, for existing customers
  successUrl: 'https://app.com/success',
  cancelUrl: 'https://app.com/cancel',
  metadata: {
    accountId: 'account-123',
    userId: 'user-456'
  }
});

// Redirect user to checkout
redirect(session.url);
```

### Customer Portal

```typescript
import { createPortalSession } from '@kit/billing-gateway';

// Create portal session for customer to manage subscription
const portal = await createPortalSession({
  customerId: 'cus_123',
  accountId: 'account-123',
  returnUrl: 'https://app.com/billing'
});

// Redirect to portal
redirect(portal.url);
```

### Subscription Management

```typescript
import {
  getSubscription,
  updateSubscription,
  cancelSubscription,
  resumeSubscription
} from '@kit/billing-gateway';

// Get subscription details
const subscription = await getSubscription('sub_123');

// Update subscription (change plan)
await updateSubscription({
  subscriptionId: 'sub_123',
  priceId: 'price_new_plan'
});

// Cancel subscription (at period end)
await cancelSubscription('sub_123');

// Resume cancelled subscription
await resumeSubscription('sub_123');
```

### Webhook Handling

```typescript
// app/api/webhooks/billing/route.ts
import { handleBillingWebhook } from '@kit/billing-gateway';
import { headers } from 'next/headers';

export async function POST(request: Request) {
  const body = await request.text();
  const signature = headers().get('stripe-signature'); // or equivalent

  try {
    await handleBillingWebhook({
      body,
      signature,
      provider: process.env.BILLING_PROVIDER
    });

    return new Response('OK', { status: 200 });
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response('Webhook Error', { status: 400 });
  }
}
```

## React Components

### Pricing Table

```typescript
import { PricingTable } from '@kit/billing-gateway/components';

export function PricingPage() {
  return (
    <PricingTable
      plans={[
        {
          name: 'Basic',
          priceId: 'price_basic',
          price: 9,
          currency: 'USD',
          interval: 'month',
          features: ['Feature 1', 'Feature 2']
        },
        {
          name: 'Pro',
          priceId: 'price_pro',
          price: 29,
          currency: 'USD',
          interval: 'month',
          features: ['All Basic features', 'Feature 3', 'Feature 4']
        }
      ]}
      onSelectPlan={(priceId) => {
        // Handle plan selection
      }}
    />
  );
}
```

### Checkout Button

```typescript
import { CheckoutButton } from '@kit/billing-gateway/components';

export function UpgradePage() {
  return (
    <CheckoutButton
      priceId="price_pro"
      accountId={account.id}
      className="btn-primary"
    >
      Upgrade to Pro
    </CheckoutButton>
  );
}
```

## Usage Examples

### Complete Billing Flow

```typescript
// 1. User selects a plan
const handlePlanSelection = async (priceId: string) => {
  const session = await createCheckoutSession({
    accountId: account.id,
    priceId,
    successUrl: `${window.location.origin}/billing/success`,
    cancelUrl: `${window.location.origin}/billing`
  });

  window.location.href = session.url;
};

// 2. After successful payment (success page)
export default async function SuccessPage() {
  // Subscription is automatically synced via webhooks
  const subscription = await getAccountSubscription(account.id);

  return (
    <div>
      <h1>Welcome to {subscription.planName}!</h1>
      <p>Your subscription is now active.</p>
    </div>
  );
}

// 3. Managing subscription
const handleManageSubscription = async () => {
  const portal = await createPortalSession({
    customerId: account.customerId,
    accountId: account.id,
    returnUrl: `${window.location.origin}/billing`
  });

  window.location.href = portal.url;
};
```

### Per-Seat Billing

```typescript
import { updateSubscriptionQuantity } from '@kit/billing-gateway';

// When adding team members
const handleAddMember = async (userId: string) => {
  // Add member to team
  await addTeamMember(teamId, userId);

  // Update subscription quantity
  const subscription = await getSubscription(team.subscriptionId);
  await updateSubscriptionQuantity({
    subscriptionId: subscription.id,
    quantity: subscription.quantity + 1
  });
};
```

## Webhook Events

The gateway handles these webhook events uniformly across providers:

- `checkout.session.completed` - New subscription created
- `customer.subscription.updated` - Subscription plan/status changed
- `customer.subscription.deleted` - Subscription cancelled
- `invoice.payment_succeeded` - Successful payment
- `invoice.payment_failed` - Failed payment

## Error Handling

```typescript
import { BillingError, PaymentRequiredError } from '@kit/billing-gateway';

try {
  await createCheckoutSession({ ... });
} catch (error) {
  if (error instanceof PaymentRequiredError) {
    // Handle payment required
    showUpgradePrompt();
  } else if (error instanceof BillingError) {
    // Handle general billing errors
    console.error('Billing error:', error.message);
  }
}
```

## Testing

Use test mode credentials:

```env
# Stripe test mode
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...

# LemonSqueezy test mode
LEMONSQUEEZY_TEST_MODE=true
```

Test card numbers:
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`
- Requires authentication: `4000 0025 0000 3155`

## Best Practices

1. **Always verify webhooks** - Use signature verification
2. **Handle idempotency** - Webhook events may be sent multiple times
3. **Sync subscription status** - Keep local database in sync
4. **Graceful degradation** - Handle provider outages
5. **Test thoroughly** - Use test mode for development
```
Verifies TypeScript type correctness

## Installation

```bash
pnpm add @kit/billing-gateway
```

## Package Dependencies

### Packages that use this:
- [web](../../../apps/web)
- [@kit/database-webhooks](../../database-webhooks)
- [@kit/accounts](../../features/accounts)
- [@kit/team-accounts](../../features/team-accounts)

## Code Statistics

- **Total Files**: 22
- **Total Lines**: 2,697

## Project Structure

```
packages/billing/gateway/
├── src/           # Source code
├── package.json   # Package configuration
├── tsconfig.json  # TypeScript configuration
└── README.md      # This file```

## Contributing

When making changes to this package:

1. Follow the existing code style and patterns
2. Update tests if applicable
3. Run `pnpm lint` and `pnpm typecheck` before committing
4. Update this README if adding new features or changing behavior

---

*Generated on 9/20/2025*
