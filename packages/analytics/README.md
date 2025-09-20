# @kit/analytics

Unified analytics tracking system with support for multiple providers, enabling event tracking, user identification, and page view monitoring across client and server environments.

## Purpose

This package provides a flexible analytics infrastructure that:
- Manages multiple analytics providers through a unified API
- Tracks events, page views, and user identities
- Works in both client and server environments
- Provides provider-agnostic analytics interface
- Supports custom analytics provider implementations
- Gracefully handles missing or inactive providers

## Installation

```bash
pnpm add @kit/analytics
```

## Basic Usage

### Client-Side Analytics

```typescript
import { analytics } from '@kit/analytics';

// Track a custom event
await analytics.trackEvent('button_clicked', {
  button_id: 'checkout',
  page: 'product-detail',
  product_id: 'prod_123'
});

// Track page view
await analytics.trackPageView('/products/awesome-product');

// Identify user
await analytics.identify('user_123', {
  email: 'user@example.com',
  name: 'John Doe',
  plan: 'premium'
});
```

### Server-Side Analytics

```typescript
import { analytics } from '@kit/analytics/server';

// Track server-side events
export async function POST(request: Request) {
  const data = await request.json();

  // Track API usage
  await analytics.trackEvent('api_called', {
    endpoint: '/api/checkout',
    method: 'POST',
    user_id: data.userId
  });

  // Process checkout...

  // Track successful conversion
  await analytics.trackEvent('purchase_completed', {
    order_id: order.id,
    amount: order.total.toString(),
    currency: order.currency
  });

  return Response.json({ success: true });
}
```

## Analytics Manager

### Creating an Analytics Manager

```typescript
import { createAnalyticsManager } from '@kit/analytics';
import type { AnalyticsService } from '@kit/analytics/types';

// Define available providers
type Providers = 'google' | 'segment' | 'mixpanel';

// Create manager with providers
const analytics = createAnalyticsManager<Providers, any>({
  providers: {
    google: () => new GoogleAnalyticsService(),
    segment: () => new SegmentAnalyticsService(),
    mixpanel: () => new MixpanelAnalyticsService()
  }
});

// Use the analytics manager
await analytics.trackEvent('user_signup', {
  source: 'organic',
  referrer: 'google'
});
```

### Managing Providers

```typescript
// Add a provider dynamically
await analytics.addProvider('google', {
  trackingId: 'GA-XXXXXXX'
});

// Remove a provider
analytics.removeProvider('mixpanel');

// All methods work with active providers
await analytics.trackEvent('event_name'); // Sent to all active providers
```

## Creating Custom Providers

### Implement AnalyticsService Interface

```typescript
import type { AnalyticsService } from '@kit/analytics/types';

export class CustomAnalyticsService implements AnalyticsService {
  private apiKey: string;
  private client: any;

  constructor(config: { apiKey: string }) {
    this.apiKey = config.apiKey;
  }

  async initialize(): Promise<void> {
    // Initialize your analytics client
    this.client = await createAnalyticsClient({
      apiKey: this.apiKey
    });
  }

  async trackEvent(
    name: string,
    properties?: Record<string, string | string[]>
  ): Promise<void> {
    await this.client.track({
      event: name,
      properties,
      timestamp: new Date().toISOString()
    });
  }

  async trackPageView(path: string): Promise<void> {
    await this.client.page({
      path,
      url: `${window.location.origin}${path}`,
      referrer: document.referrer
    });
  }

  async identify(
    userId: string,
    traits?: Record<string, string>
  ): Promise<void> {
    await this.client.identify({
      userId,
      traits,
      timestamp: new Date().toISOString()
    });
  }
}
```

### Register Custom Provider

```typescript
import { createAnalyticsManager } from '@kit/analytics';
import { CustomAnalyticsService } from './custom-analytics';

const analytics = createAnalyticsManager({
  providers: {
    custom: (config) => new CustomAnalyticsService(config)
  }
});
```

## PostHog Integration Example

```typescript
import { PostHogAnalyticsService } from '@kit/analytics/providers/posthog';

const analytics = createAnalyticsManager({
  providers: {
    posthog: () => new PostHogAnalyticsService({
      apiKey: process.env.NEXT_PUBLIC_POSTHOG_KEY!,
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST
    })
  }
});

// Track feature usage
await analytics.trackEvent('feature_used', {
  feature: 'advanced-search',
  user_tier: 'premium'
});

// Track conversion funnel
await analytics.trackEvent('checkout_started', {
  cart_value: '99.99',
  items_count: '3'
});

await analytics.trackEvent('payment_method_selected', {
  method: 'credit_card'
});

await analytics.trackEvent('checkout_completed', {
  order_id: 'ORD-12345',
  revenue: '99.99'
});
```

## Google Analytics 4 Example

```typescript
import { GA4AnalyticsService } from '@kit/analytics/providers/ga4';

const analytics = createAnalyticsManager({
  providers: {
    ga4: () => new GA4AnalyticsService({
      measurementId: 'G-XXXXXXXXXX'
    })
  }
});

// Track e-commerce events
await analytics.trackEvent('view_item', {
  currency: 'USD',
  value: '29.99',
  item_id: 'SKU123',
  item_name: 'Premium Feature'
});

// Track engagement
await analytics.trackEvent('scroll', {
  percent_scrolled: '90'
});
```

## Null Analytics Service

When no providers are configured, the system uses `NullAnalyticsService`:

```typescript
import { NullAnalyticsService } from '@kit/analytics/null-analytics-service';

// Automatically used when no providers are active
// All methods are no-ops, useful for development/testing
const nullService = NullAnalyticsService;
await nullService.trackEvent('test'); // Does nothing, logs in debug
```

## Event Tracking Patterns

### User Actions

```typescript
// Button clicks
await analytics.trackEvent('button_clicked', {
  button_id: 'cta-hero',
  button_text: 'Get Started',
  location: 'above_fold'
});

// Form submissions
await analytics.trackEvent('form_submitted', {
  form_id: 'contact',
  form_type: 'lead_generation',
  fields_filled: '5'
});

// Navigation
await analytics.trackEvent('menu_clicked', {
  menu_item: 'pricing',
  menu_location: 'header'
});
```

### Feature Usage

```typescript
// Feature activation
await analytics.trackEvent('feature_activated', {
  feature_name: 'dark_mode',
  activation_method: 'settings_toggle'
});

// API usage
await analytics.trackEvent('api_key_created', {
  key_type: 'production',
  permissions: 'read_write'
});

// Export actions
await analytics.trackEvent('data_exported', {
  export_format: 'csv',
  records_count: '1000'
});
```

### Business Events

```typescript
// Subscription events
await analytics.trackEvent('subscription_started', {
  plan: 'premium',
  billing_period: 'monthly',
  value: '29.99'
});

await analytics.trackEvent('subscription_cancelled', {
  plan: 'premium',
  cancellation_reason: 'too_expensive',
  tenure_days: '45'
});

// Revenue events
await analytics.trackEvent('payment_received', {
  amount: '299.99',
  currency: 'USD',
  payment_method: 'stripe'
});
```

## User Identification

```typescript
// Initial identification
await analytics.identify(user.id, {
  email: user.email,
  name: user.name,
  created_at: user.createdAt,
  plan: 'free'
});

// Update user traits
await analytics.identify(user.id, {
  plan: 'premium',
  upgraded_at: new Date().toISOString(),
  lifetime_value: '599.88'
});

// Add custom properties
await analytics.identify(user.id, {
  company: 'Acme Corp',
  role: 'admin',
  team_size: '10-50'
});
```

## Page View Tracking

```typescript
// Manual page tracking
await analytics.trackPageView('/dashboard');
await analytics.trackPageView('/settings/billing');

// With Next.js router
import { usePathname } from 'next/navigation';
import { useEffect } from 'react';

function AnalyticsProvider({ children }) {
  const pathname = usePathname();

  useEffect(() => {
    analytics.trackPageView(pathname);
  }, [pathname]);

  return children;
}
```

## Environment Configuration

```typescript
// Development: Use null service
const analytics = process.env.NODE_ENV === 'development'
  ? createAnalyticsManager({ providers: {} })
  : createAnalyticsManager({
      providers: {
        posthog: () => new PostHogAnalyticsService(config)
      }
    });

// Feature flags for providers
const providers = {};

if (process.env.ENABLE_GA4 === 'true') {
  providers.ga4 = () => new GA4Service(ga4Config);
}

if (process.env.ENABLE_SEGMENT === 'true') {
  providers.segment = () => new SegmentService(segmentConfig);
}

const analytics = createAnalyticsManager({ providers });
```

## Error Handling

```typescript
import { getLogger } from '@kit/shared/logger';

async function trackSafely(eventName: string, properties?: any) {
  const logger = await getLogger();

  try {
    await analytics.trackEvent(eventName, properties);
  } catch (error) {
    logger.error(
      { eventName, properties, error },
      'Failed to track analytics event'
    );

    // Don't throw - analytics should not break the app
  }
}
```

## Testing

```typescript
import { createAnalyticsManager } from '@kit/analytics';
import { MockAnalyticsService } from '@kit/analytics/testing';

describe('Analytics Tracking', () => {
  let analytics: AnalyticsManager;
  let mockService: MockAnalyticsService;

  beforeEach(() => {
    mockService = new MockAnalyticsService();
    analytics = createAnalyticsManager({
      providers: {
        mock: () => mockService
      }
    });
  });

  it('should track events', async () => {
    await analytics.trackEvent('test_event', { foo: 'bar' });

    expect(mockService.events).toContainEqual({
      name: 'test_event',
      properties: { foo: 'bar' }
    });
  });

  it('should identify users', async () => {
    await analytics.identify('user123', { email: 'test@example.com' });

    expect(mockService.identifications).toContainEqual({
      userId: 'user123',
      traits: { email: 'test@example.com' }
    });
  });
});
```

## Best Practices

1. **Track meaningful events** - Focus on business-critical user actions
2. **Use consistent naming** - Establish naming conventions (e.g., `noun_verb`)
3. **Include context** - Add relevant properties to events
4. **Avoid PII in properties** - Don't track sensitive personal information
5. **Batch events when possible** - Reduce network overhead
6. **Handle errors gracefully** - Don't let analytics break your app
7. **Test tracking** - Verify events are sent correctly
8. **Document events** - Maintain an event tracking plan
9. **Use server-side for critical events** - More reliable than client-side
10. **Respect user privacy** - Implement opt-out mechanisms

## Type Definitions

```typescript
// Core types
export interface AnalyticsService {
  initialize(): Promise<void>;
  trackEvent(name: string, properties?: Record<string, string | string[]>): Promise<void>;
  trackPageView(path: string): Promise<void>;
  identify(userId: string, traits?: Record<string, string>): Promise<void>;
}

export interface AnalyticsManager {
  addProvider<T extends string, Config>(provider: T, config: Config): Promise<void>;
  removeProvider<T extends string>(provider: T): void;
  identify(userId: string, traits?: Record<string, string>): Promise<void[]>;
  trackPageView(path: string): Promise<void[]>;
  trackEvent(eventName: string, eventProperties?: Record<string, string | string[]>): Promise<void[]>;
}
```

## Package Dependencies

### External
- TypeScript for type safety

### Internal
None - this is a foundational package

### Packages that use this:
- [web](../../apps/web)

## Contributing

When making changes to this package:

1. Maintain the AnalyticsService interface
2. Test with multiple providers
3. Handle provider failures gracefully
4. Run `pnpm typecheck` before committing
5. Document new providers and events

---

*Updated on 9/20/2025*