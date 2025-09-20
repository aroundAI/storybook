# @kit/stripe

Stripe payment provider implementation for the billing gateway, handling subscriptions, checkouts, webhooks, and customer management.

## Purpose

This package provides the Stripe-specific implementation of the billing gateway interface, including:
- Checkout session creation and management
- Subscription lifecycle management
- Customer portal integration
- Webhook event processing
- Payment method handling
- Usage-based billing support
- Invoice management
- Stripe Elements components

## Installation

```bash
pnpm add @kit/stripe
```

## Configuration

```env
# Required Stripe keys
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Optional: For testing
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
```

## Basic Usage

### Initialize Stripe Service

```typescript
import { createStripeService } from '@kit/stripe';

const stripe = createStripeService({
  secretKey: process.env.STRIPE_SECRET_KEY!,
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET!
});
```

### Create Checkout Session

```typescript
const session = await stripe.createCheckoutSession({
  priceId: 'price_1234',
  customerId: 'cus_123', // Optional
  accountId: 'acc_123',
  successUrl: 'https://app.com/success',
  cancelUrl: 'https://app.com/cancel',
  trialDays: 14, // Optional
  metadata: {
    accountId: 'acc_123',
    userId: 'user_456'
  }
});

// Redirect to Stripe Checkout
redirect(session.url);
```

### Handle Webhooks

```typescript
import { handleStripeWebhook } from '@kit/stripe';

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature')!;

  const event = await handleStripeWebhook({
    body,
    signature,
    secret: process.env.STRIPE_WEBHOOK_SECRET!
  });

  // Process event based on type
  switch (event.type) {
    case 'checkout.session.completed':
      await handleCheckoutComplete(event.data.object);
      break;
    case 'customer.subscription.updated':
      await handleSubscriptionUpdate(event.data.object);
      break;
  }

  return Response.json({ received: true });
}
```

## Subscription Management

```typescript
// Get subscription
const subscription = await stripe.getSubscription('sub_123');

// Update subscription
await stripe.updateSubscription('sub_123', {
  items: [{ price: 'price_new' }],
  proration_behavior: 'create_prorations'
});

// Cancel subscription
await stripe.cancelSubscription('sub_123', {
  at_period_end: true
});

// Resume cancelled subscription
await stripe.resumeSubscription('sub_123');
```

## Customer Portal

```typescript
const portal = await stripe.createPortalSession({
  customer: 'cus_123',
  return_url: 'https://app.com/billing'
});

redirect(portal.url);
```

## React Components

### Stripe Provider

```tsx
import { StripeProvider } from '@kit/stripe/components';

export function App({ children }) {
  return (
    <StripeProvider publishableKey={process.env.NEXT_PUBLIC_STRIPE_KEY}>
      {children}
    </StripeProvider>
  );
}
```

### Payment Element

```tsx
import { PaymentElement } from '@kit/stripe/components';

export function CheckoutForm() {
  return (
    <PaymentElement
      clientSecret={clientSecret}
      onSuccess={(paymentIntent) => {
        console.log('Payment successful:', paymentIntent);
      }}
      onError={(error) => {
        console.error('Payment failed:', error);
      }}
    />
  );
}
```

## Usage-Based Billing

```typescript
// Report usage
await stripe.reportUsage({
  subscription_item: 'si_123',
  quantity: 100,
  timestamp: Math.floor(Date.now() / 1000),
  action: 'increment'
});

// Get usage records
const usage = await stripe.getUsageRecords('si_123', {
  limit: 100
});
```

## Testing

Use Stripe test mode:
- Test cards: https://stripe.com/docs/testing
- Webhook testing: Use Stripe CLI
- Test clocks for subscription testing

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Forward webhooks to local
stripe listen --forward-to localhost:3000/api/webhooks/stripe

# Trigger test events
stripe trigger checkout.session.completed
```

## Package Dependencies

### External
- `stripe`: Stripe Node.js SDK
- `@stripe/stripe-js`: Stripe.js library
- `@stripe/react-stripe-js`: React components
- `zod`: Schema validation

### Internal
- `@kit/billing`: Core billing types and schemas
- `@kit/supabase`: Database operations

### Packages that use this:
- [@kit/billing-gateway](../gateway)
- [@kit/database-webhooks](../../database-webhooks)

## Contributing

When making changes to this package:

1. Test with Stripe CLI for webhooks
2. Verify webhook signature validation
3. Test subscription lifecycle
4. Run `pnpm typecheck` before committing
5. Update types for new Stripe features

---

*Updated on 9/20/2025*