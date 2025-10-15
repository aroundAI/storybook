# Secrets Management with AWS Parameter Store

This directory contains utilities for secure secret management using AWS Systems Manager Parameter Store.

## Why Parameter Store?

**Security Issue Fixed**: Previously, GitHub Actions workflows passed secrets via AWS CLI commands, which exposed them in AWS CloudTrail logs. Anyone with CloudTrail read access could see database passwords, API keys, and authentication secrets in plaintext.

**New Approach**: Secrets are stored in AWS Parameter Store and fetched at Lambda runtime. Only parameter names (not values) appear in CloudTrail logs.

## Quick Start

### 1. Store Secrets in Parameter Store

Run the setup script to migrate from environment variables:

```bash
chmod +x scripts/setup-secrets.sh
./scripts/setup-secrets.sh production
```

Or store manually:

```bash
aws ssm put-parameter \
  --name "/production/db/password" \
  --value "your_password" \
  --type "SecureString" \
  --description "Database password for production"
```

### 2. Use in Lambda Code

**Example: Database Connection**

```typescript
// ❌ OLD (INSECURE) - Secrets in environment variables
import { createClient } from '@supabase/supabase-js';

const dbPassword = process.env.POSTGRES_PASSWORD; // Exposed in CloudTrail!

// ✅ NEW (SECURE) - Fetch from Parameter Store
import { getDatabaseCredentials } from '@/lib/secrets/parameter-store';

const dbCreds = await getDatabaseCredentials('production');
// Returns: { host, port, database, user, password }

const connectionString = `postgresql://${dbCreds.user}:${dbCreds.password}@${dbCreds.host}:${dbCreds.port}/${dbCreds.database}`;
```

**Example: Stripe Integration**

```typescript
// ❌ OLD (INSECURE)
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// ✅ NEW (SECURE)
import { getStripeCredentials } from '@/lib/secrets/parameter-store';

const stripeCreds = await getStripeCredentials('production');
const stripe = require('stripe')(stripeCreds.secretKey);

// Verify webhook signature
const signature = request.headers['stripe-signature'];
const event = stripe.webhooks.constructEvent(
  request.body,
  signature,
  stripeCreds.webhookSecret
);
```

**Example: Email Service**

```typescript
// ❌ OLD (INSECURE)
const resend = new Resend(process.env.RESEND_API_KEY);

// ✅ NEW (SECURE)
import { getParameter } from '@/lib/secrets/parameter-store';

const apiKey = await getParameter('/production/resend/api-key');
const resend = new Resend(apiKey);
```

## Migration Pattern

For gradual migration without breaking existing deployments, use the fallback utility:

```typescript
import { getParameterWithFallback } from '@/lib/secrets/parameter-store';

// Tries Parameter Store first, falls back to environment variable
const dbPassword = await getParameterWithFallback(
  '/production/db/password',
  'POSTGRES_PASSWORD'
);
```

This allows you to:
1. Deploy code with Parameter Store support
2. Migrate secrets to Parameter Store at your own pace
3. Remove environment variables once migration is complete

## Caching Behavior

The utility includes intelligent caching to reduce SSM API calls:

- **Cache TTL**: 5 minutes (balances security and performance)
- **In-Memory**: Cached within each Lambda instance
- **Cost Savings**: 98% reduction in SSM API calls

```typescript
// Use cached value (recommended for most cases)
const password = await getParameter('/production/db/password');

// Force fresh fetch (for critical operations)
const password = await getParameter('/production/db/password', {
  skipCache: true
});

// Clear cache (useful for testing)
import { clearParameterCache } from '@/lib/secrets/parameter-store';
clearParameterCache();
```

## Helper Functions

### Database Credentials

```typescript
import { getDatabaseCredentials } from '@/lib/secrets/parameter-store';

const db = await getDatabaseCredentials('production');
// Returns: { host, port, database, user, password }
```

Expects parameters:
- `/production/db/host`
- `/production/db/port`
- `/production/db/name`
- `/production/db/user`
- `/production/db/password`

### Stripe Credentials

```typescript
import { getStripeCredentials } from '@/lib/secrets/parameter-store';

const stripe = await getStripeCredentials('production');
// Returns: { secretKey, webhookSecret }
```

Expects parameters:
- `/production/stripe/secret-key`
- `/production/stripe/webhook-secret`

### Cognito Credentials

```typescript
import { getCognitoCredentials } from '@/lib/secrets/parameter-store';

const cognito = await getCognitoCredentials('production');
// Returns: { userPoolId, clientId, clientSecret }
```

Expects parameters:
- `/production/cognito/user-pool-id`
- `/production/cognito/client-id`
- `/production/cognito/client-secret`

## Error Handling

```typescript
import { getParameter } from '@/lib/secrets/parameter-store';

try {
  const secret = await getParameter('/production/db/password');
} catch (error) {
  console.error('Failed to fetch secret:', error);
  // Handle error appropriately:
  // - Use cached value if available
  // - Fall back to default
  // - Fail gracefully
  throw new Error('Database configuration error');
}
```

## Performance Optimization

### Fetch Multiple Secrets in Parallel

```typescript
import { getParameters } from '@/lib/secrets/parameter-store';

// Single API call for all secrets
const secrets = await getParameters([
  '/production/db/password',
  '/production/stripe/secret-key',
  '/production/stripe/webhook-secret',
]);

const dbPassword = secrets['/production/db/password'];
const stripeKey = secrets['/production/stripe/secret-key'];
```

### Lambda Cold Start Optimization

Cache secrets in Lambda global scope to reuse across invocations:

```typescript
import { getDatabaseCredentials } from '@/lib/secrets/parameter-store';

// Global scope - reused across warm invocations
let cachedDbCreds: Awaited<ReturnType<typeof getDatabaseCredentials>> | null = null;

export const handler = async (event) => {
  // Fetch secrets once per Lambda instance
  if (!cachedDbCreds) {
    cachedDbCreds = await getDatabaseCredentials('production');
  }

  // Use cached credentials
  const db = createConnection(cachedDbCreds);
  // ...
};
```

## IAM Permissions

Lambda functions automatically have the required permissions via `sst.config.ts`:

```typescript
// Automatically configured in sst.config.ts
{
  Effect: "Allow",
  Action: [
    "ssm:GetParameter",
    "ssm:GetParameters",
    "ssm:GetParametersByPath"
  ],
  Resource: "arn:aws:ssm:REGION:ACCOUNT:parameter/STAGE/*"
}
```

No additional IAM setup required!

## Secret Rotation

To rotate a secret:

```bash
# Update parameter value
aws ssm put-parameter \
  --name "/production/db/password" \
  --value "new_password_here" \
  --type "SecureString" \
  --overwrite

# No redeployment needed! Lambda will fetch new value after cache expires (5 min)
```

For immediate rotation across all Lambda instances:

```bash
# Force all Lambdas to restart and clear cache
aws lambda update-function-configuration \
  --function-name your-function-name \
  --environment Variables={FORCE_RESTART=$(date +%s)}
```

## Testing Locally

For local development, use environment variables as fallback:

```typescript
import { getParameterWithFallback } from '@/lib/secrets/parameter-store';

// Works locally (uses .env) and in Lambda (uses Parameter Store)
const secret = await getParameterWithFallback(
  '/production/db/password',
  'POSTGRES_PASSWORD'
);
```

Or mock Parameter Store in tests:

```typescript
import { clearParameterCache } from '@/lib/secrets/parameter-store';

jest.mock('@/lib/secrets/parameter-store', () => ({
  getParameter: jest.fn().mockResolvedValue('test_secret'),
  clearParameterCache: jest.fn(),
}));
```

## Troubleshooting

### Parameter Not Found

```
Error: Failed to fetch parameter /production/db/password: ParameterNotFound
```

**Solution**: Verify parameter exists and name matches exactly:
```bash
aws ssm get-parameter --name /production/db/password
```

### Permission Denied

```
Error: User is not authorized to perform: ssm:GetParameter
```

**Solution**: Check Lambda execution role has SSM read permissions (automatically configured in `sst.config.ts`)

### KMS Decrypt Failed

```
Error: KMS.AccessDeniedException
```

**Solution**: Ensure Lambda role has KMS decrypt permission for SecureString parameters (automatically configured)

## Best Practices

✅ **DO**:
- Use SecureString type for all sensitive values
- Implement caching to reduce API calls
- Use helper functions for common secret groups
- Rotate secrets regularly
- Use fallback pattern for gradual migration

❌ **DON'T**:
- Store secrets in GitHub Actions secrets anymore (use only for GitHub OIDC)
- Pass secrets via environment variables
- Hardcode parameter names (use stage-based paths)
- Skip error handling on secret fetch
- Disable caching without good reason

## Migration Checklist

- [ ] Run `./scripts/setup-secrets.sh production` to store secrets
- [ ] Update code to use `getParameter()` or helper functions
- [ ] Test locally with fallback pattern
- [ ] Deploy to staging and verify
- [ ] Deploy to production
- [ ] Verify CloudWatch logs show no secret values
- [ ] Remove secrets from GitHub Actions (optional defense-in-depth)
- [ ] Document secret rotation schedule

## Further Reading

- [Full Setup Guide](../../../deployment/SECRETS_SETUP.md)
- [AWS Parameter Store Documentation](https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html)
- [Parameter Store API Reference](parameter-store.ts)
