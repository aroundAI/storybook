# @kit/lemon-squeezy

LemonSqueezy payment provider implementation for the billing gateway, providing a Merchant of Record solution with global tax handling.

## Purpose

This package provides the LemonSqueezy-specific implementation of the billing gateway interface, including:
- Checkout session creation
- Subscription management
- License key handling
- Webhook processing
- Customer portal integration
- Global tax compliance (handled by LemonSqueezy)
- Digital product delivery

## Installation

```bash
pnpm add @kit/lemon-squeezy
```

## Configuration

```env
# Required LemonSqueezy keys
LEMONSQUEEZY_API_KEY=your_api_key
LEMONSQUEEZY_STORE_ID=your_store_id
LEMONSQUEEZY_WEBHOOK_SECRET=your_webhook_secret

# Optional: Test mode
LEMONSQUEEZY_TEST_MODE=true
```

## Basic Usage

### Initialize LemonSqueezy Service

```typescript
import { createLemonSqueezyService } from '@kit/lemon-squeezy';

const lemonSqueezy = createLemonSqueezyService({
  apiKey: process.env.LEMONSQUEEZY_API_KEY!,
  storeId: process.env.LEMONSQUEEZY_STORE_ID!,
  webhookSecret: process.env.LEMONSQUEEZY_WEBHOOK_SECRET!
});
```

### Create Checkout

```typescript
const checkout = await lemonSqueezy.createCheckout({
  variantId: 'variant_123',
  email: 'customer@example.com',
  accountId: 'acc_123',
  custom: {
    accountId: 'acc_123',
    userId: 'user_456'
  },
  checkoutData: {
    discount_code: 'SAVE20'
  }
});

// Redirect to LemonSqueezy checkout
redirect(checkout.url);
```

### Handle Webhooks

```typescript
import { handleLemonSqueezyWebhook } from '@kit/lemon-squeezy';

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get('x-signature')!;

  const event = await handleLemonSqueezyWebhook({
    body,
    signature,
    secret: process.env.LEMONSQUEEZY_WEBHOOK_SECRET!
  });

  // Process events
  switch (event.meta.event_name) {
    case 'subscription_created':
      await handleNewSubscription(event.data);
      break;
    case 'subscription_updated':
      await handleSubscriptionUpdate(event.data);
      break;
  }

  return Response.json({ success: true });
}
```

## Subscription Management

```typescript
// Get subscription
const subscription = await lemonSqueezy.getSubscription('sub_123');

// Update subscription
await lemonSqueezy.updateSubscription('sub_123', {
  variantId: 'variant_new_plan',
  invoiceImmediately: true
});

// Cancel subscription
await lemonSqueezy.cancelSubscription('sub_123');

// Resume subscription
await lemonSqueezy.resumeSubscription('sub_123');

// Pause subscription
await lemonSqueezy.pauseSubscription('sub_123', {
  mode: 'void', // or 'free'
  resumesAt: '2024-12-01'
});
```

## Customer Portal

```typescript
const customerPortal = await lemonSqueezy.getCustomerPortalUrl({
  customerId: 'cus_123'
});

redirect(customerPortal.url);
```

## License Keys

```typescript
// Activate license key
const activation = await lemonSqueezy.activateLicense({
  licenseKey: 'XXXX-XXXX-XXXX-XXXX',
  instanceName: 'User Device'
});

// Validate license
const validation = await lemonSqueezy.validateLicense({
  licenseKey: 'XXXX-XXXX-XXXX-XXXX'
});

// Deactivate license
await lemonSqueezy.deactivateLicense({
  licenseKey: 'XXXX-XXXX-XXXX-XXXX',
  instanceId: 'instance_123'
});
```

## React Components

### LemonSqueezy Button

```tsx
import { LemonSqueezyButton } from '@kit/lemon-squeezy/components';

export function PricingCard() {
  return (
    <LemonSqueezyButton
      variantId="variant_123"
      accountId={account.id}
      className="btn-primary"
    >
      Subscribe Now
    </LemonSqueezyButton>
  );
}
```

## Advantages of LemonSqueezy

- **Merchant of Record**: Handles global tax compliance
- **Simple pricing**: One fee covers everything
- **Global payments**: Supports multiple payment methods
- **Built for SaaS**: Designed specifically for software businesses
- **No tax headaches**: They handle VAT, sales tax, etc.

## Testing

```bash
# Use test mode
LEMONSQUEEZY_TEST_MODE=true

# Test card numbers
4242 4242 4242 4242 (Visa)
5555 5555 5555 4444 (Mastercard)
```

## Package Dependencies

### External
- `@lemonsqueezy/lemonsqueezy.js`: Official SDK
- `zod`: Schema validation

### Internal
- `@kit/billing`: Core billing types
- `@kit/supabase`: Database operations

### Packages that use this:
- [@kit/billing-gateway](../gateway)

## Contributing

When making changes to this package:

1. Test webhook signatures
2. Verify subscription flows
3. Test license key management
4. Run `pnpm typecheck` before committing
5. Update types for new LemonSqueezy features

---

*Updated on 9/20/2025*