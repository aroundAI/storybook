# AWS Parameter Store Secrets Setup

This guide explains how to securely manage secrets using AWS Systems Manager Parameter Store instead of environment variables in GitHub Actions workflows.

## Why Parameter Store?

### Security Benefits

1. **No CloudTrail Exposure**: Parameter names (not values) are logged in CloudTrail
2. **KMS Encryption**: Secrets encrypted at rest with AWS Key Management Service
3. **Secret Rotation**: Rotate secrets without redeploying Lambda code
4. **Fine-Grained Access**: IAM policies control who can access which secrets
5. **Audit Trail**: Track who accessed secrets (not the secret values themselves)

### Previous Security Issue

❌ **Old approach (INSECURE)**:
```yaml
# GitHub Actions workflow
aws lambda update-function-configuration \
  --environment "Variables={
    POSTGRES_PASSWORD=${{ secrets.POSTGRES_PASSWORD }},  # ⚠️ Exposed in CloudTrail!
    STRIPE_SECRET_KEY=${{ secrets.STRIPE_SECRET_KEY }}   # ⚠️ Exposed in CloudTrail!
  }"
```

**Problem**: All secret values were logged in AWS CloudTrail in plaintext, creating a permanent security risk.

✅ **New approach (SECURE)**:
```typescript
// Lambda code fetches secrets at runtime
import { getParameter } from '@/lib/secrets/parameter-store';

const dbPassword = await getParameter('/production/db/password');
// ✓ Only parameter NAME logged in CloudTrail, not the value
```

---

## Quick Start

### Prerequisites

- AWS CLI installed and configured
- AWS credentials with SSM parameter write permissions
- Deployment stage identified (production, staging, etc.)

### 1. Run Setup Script

The easiest way to migrate secrets is using our interactive setup script:

```bash
# Make script executable
chmod +x scripts/setup-secrets.sh

# Run for production
./scripts/setup-secrets.sh production

# Or for staging
./scripts/setup-secrets.sh staging
```

The script will:
1. Read values from your `.env` files (if available)
2. Prompt for any missing values
3. Store secrets in AWS Parameter Store with proper encryption
4. Provide verification commands

### 2. Verify Secrets Were Stored

```bash
# List all parameters for your stage
aws ssm get-parameters-by-path --path /production/ --recursive

# Get a specific parameter (with decryption)
aws ssm get-parameter --name /production/db/password --with-decryption
```

### 3. Deploy Updated Lambda Code

The updated Lambda code will automatically fetch secrets from Parameter Store:

```bash
pnpm sst deploy --stage production
```

---

## Manual Setup (Alternative to Script)

If you prefer manual setup or need to add custom parameters:

### Database Credentials

```bash
STAGE="production"  # or "staging"

aws ssm put-parameter \
  --name "/${STAGE}/db/host" \
  --value "your-db-host.rds.amazonaws.com" \
  --type "String" \
  --description "Database host for ${STAGE}"

aws ssm put-parameter \
  --name "/${STAGE}/db/port" \
  --value "5432" \
  --type "String" \
  --description "Database port for ${STAGE}"

aws ssm put-parameter \
  --name "/${STAGE}/db/name" \
  --value "your_database" \
  --type "String" \
  --description "Database name for ${STAGE}"

aws ssm put-parameter \
  --name "/${STAGE}/db/user" \
  --value "db_user" \
  --type "String" \
  --description "Database user for ${STAGE}"

aws ssm put-parameter \
  --name "/${STAGE}/db/password" \
  --value "your_secure_password" \
  --type "SecureString" \
  --description "Database password for ${STAGE}"
```

### Stripe Credentials

```bash
aws ssm put-parameter \
  --name "/${STAGE}/stripe/secret-key" \
  --value "sk_live_..." \
  --type "SecureString" \
  --description "Stripe secret key for ${STAGE}"

aws ssm put-parameter \
  --name "/${STAGE}/stripe/webhook-secret" \
  --value "whsec_..." \
  --type "SecureString" \
  --description "Stripe webhook secret for ${STAGE}"
```

### Cognito Credentials (if using Cognito)

```bash
aws ssm put-parameter \
  --name "/${STAGE}/cognito/user-pool-id" \
  --value "us-east-1_xxxxxxxxx" \
  --type "String" \
  --description "Cognito User Pool ID for ${STAGE}"

aws ssm put-parameter \
  --name "/${STAGE}/cognito/client-id" \
  --value "your_client_id" \
  --type "String" \
  --description "Cognito Client ID for ${STAGE}"

aws ssm put-parameter \
  --name "/${STAGE}/cognito/client-secret" \
  --value "your_client_secret" \
  --type "SecureString" \
  --description "Cognito Client Secret for ${STAGE}"
```

### Supabase Credentials (if using Supabase)

```bash
aws ssm put-parameter \
  --name "/${STAGE}/supabase/service-role-key" \
  --value "your_service_role_key" \
  --type "SecureString" \
  --description "Supabase Service Role Key for ${STAGE}"
```

### Email Provider Credentials

**Resend**:
```bash
aws ssm put-parameter \
  --name "/${STAGE}/resend/api-key" \
  --value "re_..." \
  --type "SecureString" \
  --description "Resend API Key for ${STAGE}"
```

**SendGrid**:
```bash
aws ssm put-parameter \
  --name "/${STAGE}/sendgrid/api-key" \
  --value "SG...." \
  --type "SecureString" \
  --description "SendGrid API Key for ${STAGE}"
```

---

## Using Secrets in Lambda Code

### Fetch Individual Secrets

```typescript
import { getParameter } from '@/lib/secrets/parameter-store';

// In your Lambda handler or initialization code
const dbPassword = await getParameter('/production/db/password');
const stripeKey = await getParameter('/production/stripe/secret-key');
```

### Fetch Multiple Secrets at Once

More efficient when you need several secrets:

```typescript
import { getParameters } from '@/lib/secrets/parameter-store';

const secrets = await getParameters([
  '/production/db/password',
  '/production/stripe/secret-key',
  '/production/stripe/webhook-secret',
]);

const dbPassword = secrets['/production/db/password'];
const stripeKey = secrets['/production/stripe/secret-key'];
```

### Use Helper Functions

For common secret groups:

```typescript
import {
  getDatabaseCredentials,
  getStripeCredentials,
  getCognitoCredentials,
} from '@/lib/secrets/parameter-store';

// Get all database credentials at once
const dbCreds = await getDatabaseCredentials('production');
// Returns: { host, port, database, user, password }

// Get Stripe credentials
const stripeCreds = await getStripeCredentials('production');
// Returns: { secretKey, webhookSecret }

// Get Cognito credentials
const cognitoCreds = await getCognitoCredentials('production');
// Returns: { userPoolId, clientId, clientSecret }
```

### Migration Mode: Fallback to Environment Variables

During migration, you can use fallback mode:

```typescript
import { getParameterWithFallback } from '@/lib/secrets/parameter-store';

// Tries Parameter Store first, falls back to env var
const password = await getParameterWithFallback(
  '/production/db/password',
  'POSTGRES_PASSWORD'
);
```

This allows gradual migration without breaking existing deployments.

---

## IAM Permissions

Lambda functions need permissions to read from Parameter Store. This is automatically configured in `sst.config.ts`:

```typescript
// Already configured in sst.config.ts
new aws.iam.RolePolicy(`ParameterStoreReadPolicy`, {
  role: lambdaRole.name,
  policy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Action: [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath"
      ],
      Resource: `arn:aws:ssm:${region}:${accountId}:parameter/${stage}/*`
    }, {
      Effect: "Allow",
      Action: ["kms:Decrypt"],
      Resource: kmsKeyArn  // For SecureString parameters
    }]
  })
});
```

---

## Secret Rotation

### Update a Secret

```bash
# Update database password
aws ssm put-parameter \
  --name "/production/db/password" \
  --value "new_password_here" \
  --type "SecureString" \
  --overwrite

# Lambda functions will fetch the new value on next invocation
# No redeployment needed!
```

### Rotation Best Practices

1. **Update Parameter Store first**: Store new secret value
2. **Update external service**: Change password in RDS, Stripe dashboard, etc.
3. **Verify**: Test that Lambda functions can authenticate with new secret
4. **Monitor**: Check CloudWatch logs for authentication errors

### Automatic Rotation (Advanced)

For automated rotation, use AWS Secrets Manager with Lambda rotation functions:

```bash
# Convert SSM parameter to Secrets Manager for rotation
aws secretsmanager create-secret \
  --name "/production/db/password" \
  --secret-string "your_password" \
  --description "Database password with automatic rotation"

# Enable rotation (requires rotation Lambda)
aws secretsmanager rotate-secret \
  --secret-id "/production/db/password" \
  --rotation-lambda-arn "arn:aws:lambda:..."
```

---

## Caching Behavior

The Parameter Store utility includes intelligent caching:

- **Cache TTL**: 5 minutes (balances security and performance)
- **In-Memory**: Cached within each Lambda instance
- **Automatic Refresh**: Cache expires after 5 minutes
- **Skip Cache**: Use `skipCache: true` option for critical operations

```typescript
// Use cached value (recommended)
const password = await getParameter('/production/db/password');

// Force fresh fetch (bypass cache)
const password = await getParameter('/production/db/password', {
  skipCache: true
});

// Clear entire cache (useful for testing)
import { clearParameterCache } from '@/lib/secrets/parameter-store';
clearParameterCache();
```

**Why caching?**
- Reduces SSM API calls (avoid throttling)
- Improves Lambda cold start performance
- Limits costs (SSM charges $0.05 per 10,000 API calls)

---

## Cost Considerations

### AWS Systems Manager Parameter Store Pricing

- **Standard parameters**: FREE for up to 10,000 parameters
- **API calls**: $0.05 per 10,000 GetParameter API calls
- **Parameter storage**: No charge for Standard tier

### Example Cost Calculation

**Scenario**: 100,000 Lambda invocations/month, 5 secrets per invocation

- Without caching: 500,000 API calls × $0.05 / 10,000 = **$2.50/month**
- With caching (5min TTL): ~10,000 API calls × $0.05 / 10,000 = **$0.05/month**

**Savings**: 98% reduction with caching enabled

### KMS Encryption Costs

- **Key storage**: $1/month per KMS key
- **Decrypt operations**: $0.03 per 10,000 requests
- **SST already creates KMS key**: No additional cost

---

## Troubleshooting

### Parameter Not Found

```
Error: Failed to fetch parameter /production/db/password: ParameterNotFound
```

**Solution**:
1. Verify parameter exists: `aws ssm get-parameter --name /production/db/password`
2. Check parameter name matches exactly (case-sensitive)
3. Ensure IAM permissions allow access to this parameter

### Permission Denied

```
Error: User is not authorized to perform: ssm:GetParameter
```

**Solution**:
1. Check Lambda execution role has SSM read permissions
2. Verify IAM policy includes correct parameter path: `/${stage}/*`
3. Ensure KMS decrypt permission exists for SecureString parameters

### Decrypt Failed

```
Error: KMS.AccessDeniedException: User is not authorized to perform: kms:Decrypt
```

**Solution**:
1. Add KMS decrypt permission to Lambda role
2. Verify KMS key policy allows Lambda role to decrypt
3. Check parameter is stored with correct KMS key

### Cache Issues

If secrets aren't updating:

```typescript
// Force cache bypass for debugging
const password = await getParameter('/production/db/password', {
  skipCache: true
});

// Or clear the entire cache
clearParameterCache();
```

---

## Security Best Practices

### ✅ DO

- Use SecureString type for all sensitive values
- Implement least-privilege IAM policies (restrict to specific parameter paths)
- Rotate secrets regularly (quarterly for high-value secrets)
- Monitor Parameter Store access via CloudTrail
- Use different parameter paths for each environment (`/production/*`, `/staging/*`)
- Enable AWS Config to track parameter changes

### ❌ DON'T

- Store secrets in GitHub Actions secrets anymore (use only for GitHub OIDC)
- Use String type for passwords or API keys (always use SecureString)
- Grant `ssm:*` permissions (be specific: `GetParameter`, `GetParameters`)
- Share parameter paths across environments
- Hardcode parameter names (use stage-based paths)

---

## Migration Checklist

- [ ] Run `./scripts/setup-secrets.sh` for your stage
- [ ] Verify parameters are stored: `aws ssm get-parameters-by-path --path /production/`
- [ ] Update Lambda code to use Parameter Store utility
- [ ] Deploy updated Lambda code: `pnpm sst deploy --stage production`
- [ ] Test Lambda functions can access secrets (check CloudWatch logs)
- [ ] Verify application functionality (database connections, Stripe webhooks, etc.)
- [ ] Remove secrets from GitHub Actions secrets (optional defense-in-depth)
- [ ] Document parameter naming conventions for your team
- [ ] Set up CloudWatch alarms for SSM API throttling (if high traffic)
- [ ] Schedule first secret rotation

---

## Support

For issues or questions:

1. Check CloudWatch Logs for Lambda error messages
2. Verify IAM permissions with AWS Policy Simulator
3. Review CloudTrail for SSM API call errors
4. Consult AWS SSM documentation: https://docs.aws.amazon.com/systems-manager/latest/userguide/systems-manager-parameter-store.html
