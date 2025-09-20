# @kit/database-webhooks

Database webhook handler for processing Supabase database changes and triggering corresponding actions.

## Purpose

This package handles webhooks from Supabase database changes and performs corresponding actions. It listens for database events (INSERT, UPDATE, DELETE) and triggers appropriate business logic based on the type of change.

For example:
1. When an account is deleted, we handle the cleanup of all related data in third-party services
2. When a user is invited, we send an email to the user
3. When an account member is added, we update the subscription in third-party services
4. When a subscription changes, we sync the status with the database

## Configuration

The default sender provider is directly from the Postgres database:

```env
WEBHOOK_SENDER_PROVIDER=postgres
```

Should you add a middleware to the webhook sender provider, you can do so by adding the following to the `WEBHOOK_SENDER_PROVIDER` environment variable:

```env
WEBHOOK_SENDER_PROVIDER=svix
```

For example, you can add [Svix](https://docs.svix.com/quickstart) as a webhook sender provider that receives webhooks from the database changes and forwards them to your application.

Note: Svix implementation is not available yet.

## Public API

### Webhook Handler

```typescript
import { handleDatabaseWebhook } from '@kit/database-webhooks';

// In your API route (e.g., app/api/webhooks/database/route.ts)
export async function POST(request: Request) {
  const payload = await request.json();

  // Process the webhook
  await handleDatabaseWebhook(payload);

  return new Response('OK', { status: 200 });
}
```

### Event Types

The package handles the following database events:

#### Account Events
- `accounts.DELETE` - Cleanup related data in billing providers
- `accounts.UPDATE` - Sync account changes

#### Team Member Events
- `accounts_memberships.INSERT` - Update per-seat billing when member added
- `accounts_memberships.DELETE` - Update per-seat billing when member removed

#### Invitation Events
- `team_accounts_invitations.INSERT` - Send invitation email to new member

#### Subscription Events
- `subscriptions.INSERT` - Sync new subscription status
- `subscriptions.UPDATE` - Update subscription changes
- `subscriptions.DELETE` - Handle subscription cancellation

## Usage Examples

### Setting up Database Webhooks in Supabase

1. Create a webhook endpoint in your application:

```typescript
// app/api/webhooks/database/route.ts
import { enhanceRouteHandler } from '@kit/next/routes';
import { handleDatabaseWebhook } from '@kit/database-webhooks';

export const POST = enhanceRouteHandler(
  async ({ body }) => {
    await handleDatabaseWebhook(body);
    return new Response('OK');
  },
  {
    auth: false, // Webhooks are verified by signature
  }
);
```

2. Configure the webhook in Supabase Dashboard or via SQL:

```sql
-- Example: Create webhook for team member changes
CREATE TRIGGER on_member_change
AFTER INSERT OR DELETE ON accounts_memberships
FOR EACH ROW
EXECUTE FUNCTION supabase.http_request(
  'https://your-app.com/api/webhooks/database',
  'POST',
  '{"Content-Type": "application/json"}',
  '{}',
  '1000'
);
```

### Custom Event Handlers

You can extend the webhook handler with custom logic:

```typescript
import { createDatabaseWebhookHandler } from '@kit/database-webhooks';

const customHandler = createDatabaseWebhookHandler({
  onAccountDeleted: async (accountId) => {
    // Custom cleanup logic
    await cleanupCustomData(accountId);
  },

  onMemberAdded: async (accountId, userId) => {
    // Custom onboarding logic
    await sendWelcomePackage(userId);
  },

  onSubscriptionUpdated: async (subscription) => {
    // Custom subscription logic
    await updateFeatureFlags(subscription);
  }
});
```

## Architecture

The package follows an event-driven architecture:

1. **Database Change** → Supabase triggers webhook
2. **Webhook Receipt** → Package validates and parses payload
3. **Event Router** → Routes to appropriate handler based on table/operation
4. **Business Logic** → Executes corresponding action (email, billing update, etc.)
5. **Error Handling** → Retries and logs failures

## Dependencies

This package integrates with:
- `@kit/billing-gateway` - For subscription and billing updates
- `@kit/stripe` - For Stripe-specific billing operations
- `@kit/team-accounts` - For team member management
- `@kit/email-templates` - For sending notification emails
- `@kit/supabase` - For database operations

## Error Handling

The package includes robust error handling:

```typescript
try {
  await handleDatabaseWebhook(payload);
} catch (error) {
  if (error instanceof WebhookVerificationError) {
    // Invalid signature - potential security issue
    return new Response('Unauthorized', { status: 401 });
  }

  if (error instanceof WebhookProcessingError) {
    // Processing failed - may need retry
    console.error('Webhook processing failed:', error);
    // Consider implementing retry logic
    return new Response('Processing Error', { status: 500 });
  }

  throw error;
}
```

## Testing

Test webhooks locally using the Supabase CLI:

```bash
# Start local Supabase
pnpm supabase:web:start

# Trigger a test webhook
supabase functions invoke webhook-test --body '{
  "type": "INSERT",
  "table": "accounts_memberships",
  "record": { "account_id": "123", "user_id": "456" }
}'
```

## Security

- Webhooks should be verified using signatures when available
- Always validate payload structure before processing
- Use environment-specific webhook URLs
- Implement rate limiting on webhook endpoints
- Log all webhook events for audit purposes

## Monitoring

Monitor webhook processing:
- Track success/failure rates
- Monitor processing time
- Alert on repeated failures
- Log payload sizes
- Track event types distribution
