# Deployment Guide: Vendor-Agnostic SaaS Platform

This guide covers deploying your SaaS application to different platforms using the vendor-agnostic infrastructure layer.

---

## Table of Contents

1. [Quick Start](#quick-start)
2. [Deployment Options](#deployment-options)
3. [AWS Deployment](#aws-deployment)
4. [Vercel + Supabase Deployment](#vercel--supabase-deployment)
5. [Hybrid Deployment](#hybrid-deployment)
6. [Environment Configuration](#environment-configuration)
7. [Database Migrations](#database-migrations)
8. [Troubleshooting](#troubleshooting)

---

## Quick Start

### Choose Your Stack

```bash
# Option 1: Supabase (Fastest)
cp .env.supabase.example .env.production

# Option 2: AWS (Full Control)
cp .env.aws.example .env.production

# Option 3: Hybrid (Best Value)
cp .env.hybrid.example .env.production
```

### Deploy

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Deploy (varies by platform)
vercel deploy --prod          # Vercel
# or
pnpm run deploy:aws           # AWS via GitHub Actions
```

---

## Deployment Options

### Comparison Matrix

| Platform | Time to Deploy | Monthly Cost | Best For | Difficulty |
|----------|----------------|--------------|----------|------------|
| **Vercel + Supabase** | 10 mins | $35 | MVPs, rapid iteration | Easy |
| **AWS** | 2-4 hours | $95 | Scale, compliance | Medium |
| **Hybrid** | 1 hour | $37 | Cost optimization | Easy |

---

## AWS Deployment

### Prerequisites

1. AWS Account with admin access
2. AWS CLI installed and configured
3. GitHub repository
4. Domain name (optional)

### Step 1: Create AWS Resources

#### 1.1 Create RDS PostgreSQL Database

```bash
# Create database
aws rds create-db-instance \
  --db-instance-identifier my-saas-db \
  --db-instance-class db.t3.medium \
  --engine postgres \
  --engine-version 15.4 \
  --master-username admin \
  --master-user-password YourSecurePassword123! \
  --allocated-storage 20 \
  --storage-type gp3 \
  --backup-retention-period 7 \
  --preferred-backup-window "03:00-04:00" \
  --preferred-maintenance-window "mon:04:00-mon:05:00" \
  --no-publicly-accessible \
  --vpc-security-group-ids sg-xxxxx \
  --db-subnet-group-name my-subnet-group

# Wait for database to be available (5-10 mins)
aws rds wait db-instance-available \
  --db-instance-identifier my-saas-db

# Get connection endpoint
aws rds describe-db-instances \
  --db-instance-identifier my-saas-db \
  --query 'DBInstances[0].Endpoint.Address' \
  --output text
```

#### 1.2 Create Cognito User Pool (Authentication)

```bash
# Create user pool
aws cognito-idp create-user-pool \
  --pool-name my-saas-users \
  --policies "PasswordPolicy={MinimumLength=8,RequireUppercase=true,RequireLowercase=true,RequireNumbers=true,RequireSymbols=true}" \
  --auto-verified-attributes email \
  --mfa-configuration OPTIONAL \
  --username-attributes email

# Create app client
aws cognito-idp create-user-pool-client \
  --user-pool-id us-east-1_xxxxx \
  --client-name my-saas-app \
  --generate-secret \
  --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH
```

#### 1.3 Create S3 Bucket (Storage)

```bash
# Create bucket
aws s3api create-bucket \
  --bucket my-saas-storage \
  --region us-east-1

# Enable versioning
aws s3api put-bucket-versioning \
  --bucket my-saas-storage \
  --versioning-configuration Status=Enabled

# Configure CORS
aws s3api put-bucket-cors \
  --bucket my-saas-storage \
  --cors-configuration file://cors-config.json

# Block public access
aws s3api put-public-access-block \
  --bucket my-saas-storage \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

<details>
<summary>cors-config.json</summary>

```json
{
  "CORSRules": [
    {
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["GET", "PUT", "POST", "DELETE", "HEAD"],
      "AllowedOrigins": ["https://your-domain.com"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3000
    }
  ]
}
```
</details>

#### 1.4 Configure Email Provider

**Option A: AWS SES** (Best for AWS deployments)

```bash
# Verify domain
aws ses verify-domain-identity --domain your-domain.com

# Add DNS records (from output above)
# Then verify
aws ses get-identity-verification-attributes \
  --identities your-domain.com

# Move out of sandbox (production)
aws ses put-account-sending-enabled --enable
```

**Option B: Resend** (Easiest setup, great free tier)

1. Sign up at [resend.com](https://resend.com)
2. Create API key in dashboard
3. Verify domain (add DNS records)
4. Configure in environment:

```bash
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxxxxxxxxxx
EMAIL_SENDER=noreply@your-domain.com
```

**Resend Benefits**:
- ✅ Free tier: 3,000 emails/month
- ✅ No sandbox mode restrictions
- ✅ Simple HTTP API (no SDK needed)
- ✅ Great deliverability rates
- ✅ Built-in email templates (React Email)

#### 1.5 Create SQS Queue (Background Jobs)

```bash
# Create queue
aws sqs create-queue \
  --queue-name my-saas-email-queue \
  --attributes \
    VisibilityTimeout=300,\
    MessageRetentionPeriod=1209600,\
    ReceiveMessageWaitTimeSeconds=20

# Create dead-letter queue
aws sqs create-queue \
  --queue-name my-saas-email-dlq \
  --attributes MessageRetentionPeriod=1209600

# Configure redrive policy
aws sqs set-queue-attributes \
  --queue-url https://sqs.us-east-1.amazonaws.com/123/my-saas-email-queue \
  --attributes file://redrive-policy.json
```

#### 1.6 Configure Redis Cache (Optional)

Redis caching improves authorization performance by caching role/permission lookups for 5 minutes, reducing database queries by up to 80%.

**Option A: AWS ElastiCache** (Production, VPC-based)

```bash
# Prerequisites: VPC with subnets in multiple AZs
VPC_ID=vpc-xxxxx
SUBNET_IDS=subnet-xxxxx,subnet-yyyyy

# Create Redis cluster
aws elasticache create-replication-group \
  --replication-group-id my-saas-cache \
  --replication-group-description "Authorization cache" \
  --engine redis \
  --engine-version 7.1 \
  --cache-node-type cache.t4g.micro \
  --num-cache-clusters 1 \
  --cache-subnet-group-name my-subnet-group \
  --security-group-ids sg-xxxxx \
  --at-rest-encryption-enabled \
  --transit-encryption-enabled

# Get endpoint
aws elasticache describe-replication-groups \
  --replication-group-id my-saas-cache \
  --query 'ReplicationGroups[0].NodeGroups[0].PrimaryEndpoint.Address' \
  --output text
```

**Configure in .env**:
```bash
CACHE_PROVIDER=redis
USE_ELASTICACHE=true
VPC_ID=vpc-xxxxx
SUBNET_IDS=subnet-xxxxx,subnet-yyyyy
VPC_CIDR=10.0.0.0/16
```

**Cost**: ~$12/month (cache.t4g.micro)

---

**Option B: Upstash Redis** (Serverless, no VPC needed)

Best for:
- Serverless deployments (Vercel, AWS Lambda outside VPC)
- Quick setup without VPC configuration
- Pay-per-request pricing

```bash
# 1. Sign up at upstash.com
# 2. Create Redis database (select region close to your app)
# 3. Copy connection URL from dashboard
```

**Configure in .env**:
```bash
CACHE_PROVIDER=redis
REDIS_URL=redis://default:your_password@your-redis.upstash.io:6379
```

**Cost**:
- Free tier: 10,000 commands/day
- Paid: $0.20 per 100K commands

---

**Option C: In-Memory Cache** (Development, no setup needed)

```bash
CACHE_PROVIDER=memory
# or omit - memory is default
```

**Benefits**:
- ✅ No infrastructure setup
- ✅ Zero cost
- ✅ Works immediately

**Limitations**:
- ❌ Cache is per-Lambda instance (not shared)
- ❌ Cache lost on Lambda cold start
- ❌ Not suitable for production

---

**Performance Impact**:

| Without Cache | With Redis | Improvement |
|--------------|------------|-------------|
| 2-3 DB queries per auth check | 0 queries (cache hit) | **5-10% faster endpoints** |
| ~50ms auth overhead | ~5ms cache lookup | **90% reduction** |

**Cache Invalidation**:

The cache automatically invalidates after 5 minutes. For manual invalidation (e.g., after role changes):

```typescript
import { invalidateAuthCache } from '@/lib/database/authorization';

// After updating user's role
await updateUserRole(userId, accountId, newRole);
await invalidateAuthCache(userId, accountId);
```

### Step 2: Setup Lambda Functions

#### 2.1 Create Main Application Lambda

```bash
# Create execution role
aws iam create-role \
  --role-name lambda-execution-role \
  --assume-role-policy-document file://trust-policy.json

# Attach policies
aws iam attach-role-policy \
  --role-name lambda-execution-role \
  --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole

# Create function
aws lambda create-function \
  --function-name my-saas-main \
  --runtime nodejs20.x \
  --role arn:aws:iam::123456789:role/lambda-execution-role \
  --handler index.handler \
  --memory-size 1024 \
  --timeout 30 \
  --environment Variables={NODE_ENV=production} \
  --zip-file fileb://function.zip
```

#### 2.2 Create Email Worker Lambda

```bash
aws lambda create-function \
  --function-name my-saas-email-worker \
  --runtime nodejs20.x \
  --role arn:aws:iam::123456789:role/lambda-execution-role \
  --handler index.handler \
  --memory-size 512 \
  --timeout 60 \
  --environment Variables={\
    EMAIL_PROVIDER=ses,\
    AWS_REGION=us-east-1\
  } \
  --zip-file fileb://apps/web/lambda/email-worker/email-worker.zip

# Connect to SQS trigger
aws lambda create-event-source-mapping \
  --function-name my-saas-email-worker \
  --event-source-arn arn:aws:sqs:us-east-1:123:my-saas-email-queue \
  --batch-size 10
```

### Step 3: Configure CloudFront + API Gateway

#### 3.1 Create API Gateway

```bash
# Create REST API
aws apigatewayv2 create-api \
  --name my-saas-api \
  --protocol-type HTTP \
  --target arn:aws:lambda:us-east-1:123:function:my-saas-main

# Create stage
aws apigatewayv2 create-stage \
  --api-id abcdef123 \
  --stage-name production \
  --auto-deploy
```

#### 3.2 Create CloudFront Distribution

```bash
# Create distribution
aws cloudfront create-distribution \
  --distribution-config file://cloudfront-config.json

# Get distribution ID
DISTRIBUTION_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[0].Id" \
  --output text)

echo "CloudFront Distribution: $DISTRIBUTION_ID"
```

### Step 4: Configure GitHub Actions

#### 4.1 Setup OIDC for GitHub Actions

```bash
# Create OIDC provider
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --thumbprint-list 6938fd4d98bab03faadb97b34396831e3780aea1

# Create role for GitHub Actions
aws iam create-role \
  --role-name github-actions-deployment \
  --assume-role-policy-document file://github-trust-policy.json

# Attach policies
aws iam attach-role-policy \
  --role-name github-actions-deployment \
  --policy-arn arn:aws:iam::aws:policy/AWSLambda_FullAccess

aws iam attach-role-policy \
  --role-name github-actions-deployment \
  --policy-arn arn:aws:iam::aws:policy/CloudFrontFullAccess
```

<details>
<summary>github-trust-policy.json</summary>

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::123456789:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:your-org/your-repo:*"
        }
      }
    }
  ]
}
```
</details>

#### 4.2 Configure GitHub Secrets

Go to GitHub Repository → Settings → Secrets → Actions and add:

```
AWS_ROLE_ARN=arn:aws:iam::123456789:role/github-actions-deployment
AWS_REGION=us-east-1

DATABASE_PROVIDER=postgresql
POSTGRES_HOST=my-saas-db.xxxxx.us-east-1.rds.amazonaws.com
POSTGRES_DB=postgres
POSTGRES_USER=admin
POSTGRES_PASSWORD=YourSecurePassword123!

AUTH_PROVIDER=cognito
COGNITO_USER_POOL_ID=us-east-1_xxxxx
COGNITO_CLIENT_ID=xxxxx
COGNITO_CLIENT_SECRET=xxxxx

STORAGE_PROVIDER=r2
S3_BUCKET=my-saas-storage

EMAIL_PROVIDER=ses  # or 'resend' for easier setup
RESEND_API_KEY=re_xxxxx  # if using Resend

QUEUE_PROVIDER=sqs
SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/123/my-saas-email-queue

AWS_LAMBDA_FUNCTION_NAME=my-saas-main
AWS_LAMBDA_EMAIL_WORKER_NAME=my-saas-email-worker
CLOUDFRONT_DISTRIBUTION_ID=$DISTRIBUTION_ID
S3_ASSETS_BUCKET=my-saas-assets

STRIPE_SECRET_KEY=sk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxxxx

NEXT_PUBLIC_SITE_URL=https://your-domain.com
NEXT_PUBLIC_PRODUCT_NAME=Your SaaS
```

### Step 5: Deploy!

```bash
# Push to main branch to trigger deployment
git add .
git commit -m "feat: configure AWS deployment"
git push origin main

# Watch deployment
gh run watch

# Check status
curl https://your-domain.com/healthcheck
```

---

## Vercel + Supabase Deployment

**Fastest deployment option** (< 10 minutes)

### Step 1: Create Supabase Project

1. Go to [supabase.com](https://supabase.com)
2. Click "New Project"
3. Choose region closest to users
4. Wait 2-3 minutes for provisioning

### Step 2: Run Database Migrations

```bash
# Install Supabase CLI
brew install supabase/tap/supabase

# Link project
supabase link --project-ref your-project-ref

# Push migrations
supabase db push

# Generate types
pnpm supabase:web:typegen
```

### Step 3: Configure Email (Optional - Resend)

For easy email setup, use Resend instead of AWS SES:

```bash
# Sign up at resend.com
# Create API key
# Add to environment:
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_your_api_key
```

**Why Resend for Vercel + Supabase?**
- No AWS account needed
- 3,000 emails/month free
- Works immediately (no sandbox mode)
- Perfect for side projects and MVPs

### Step 4: Configure Environment

```bash
# Copy template
cp .env.supabase.example .env.production

# Edit with your values
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Add Resend for emails (optional)
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxx
```

### Step 5: Deploy to Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Login
vercel login

# Deploy
vercel --prod

# Or use Vercel GitHub integration (recommended)
# Push to main → auto-deploys
```

### Step 6: Configure Vercel Environment Variables

Go to Vercel Dashboard → Project → Settings → Environment Variables:

- Copy all from `.env.production`
- Add Stripe keys
- Add monitoring keys (Sentry, etc.)

**Done!** Your app is live at `https://your-app.vercel.app`

---

## Hybrid Deployment

**Best value**: Supabase + AWS services for specific needs

### Configuration

```bash
# Use Supabase for database + auth (best DX)
DATABASE_PROVIDER=supabase
AUTH_PROVIDER=supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co

# Use S3 for storage (cheaper at scale)
STORAGE_PROVIDER=r2
S3_BUCKET=my-saas-storage

# Use Resend for email (free tier - 3K/month)
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_xxxxx
EMAIL_SENDER=noreply@your-domain.com

# Use SQS for queue (pay per use)
QUEUE_PROVIDER=sqs
SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/123/my-queue
```

### Deploy

- **Frontend**: Vercel (or AWS CloudFront)
- **Database**: Supabase
- **Storage**: Cloudflare R2
- **Email**: Resend
- **Queue**: AWS SQS
- **Cache**: Upstash Redis

**Estimated Cost**: ~$37/month for 10K users

---

## Environment Configuration

### Production Checklist

- [ ] Database connection string configured
- [ ] Auth provider credentials set
- [ ] Storage bucket configured with CORS
- [ ] Email provider verified domain
- [ ] Stripe webhook endpoint configured
- [ ] Environment variables match `.env.production.example`
- [ ] SSL certificate configured
- [ ] CDN/CloudFront setup
- [ ] Monitoring (Sentry) configured
- [ ] Health check endpoint returns 200

### Security Best Practices

1. **Never commit `.env` files**
   ```bash
   # Add to .gitignore
   .env*
   !.env*.example
   ```

2. **Rotate secrets regularly**
   - Database passwords: Every 90 days
   - API keys: Every 180 days
   - JWT secrets: On security incidents

3. **Use environment-specific credentials**
   - Separate staging/production databases
   - Different Stripe accounts
   - Isolated AWS accounts

---

## Database Migrations

### With Supabase

```bash
# Create migration
supabase migration new add_feature

# Edit migration file
# apps/web/supabase/migrations/xxxxx_add_feature.sql

# Apply locally
supabase db reset

# Test
pnpm supabase:web:test

# Deploy to production
supabase db push --linked

# Generate updated types
pnpm supabase:web:typegen
```

### With AWS RDS

```bash
# Option 1: Manual SQL
psql $POSTGRES_CONNECTION_STRING < migration.sql

# Option 2: Use migration tool (e.g., Prisma)
pnpm exec prisma migrate deploy

# Option 3: GitHub Actions (in deploy workflow)
- name: Run migrations
  run: |
    psql ${{ secrets.POSTGRES_CONNECTION_STRING }} \
      -f apps/web/supabase/migrations/*.sql
```

---

## Troubleshooting

### SST/Lambda Deployment Issues

#### 1. "InvalidChangeBatch: CNAME already exists"

**Error**: `[Tried to create resource record set [name='_xxxxx.your-domain.com.', type='CNAME'] but it already exists]`

**Cause**: ACM certificate validation records exist from a previous deployment or manual certificate creation.

**Solutions**:

**Option A: Deploy without domain first (Recommended)**
```bash
# Step 1: Deploy without custom domain
export SKIP_DOMAIN=true
pnpm sst deploy --stage staging

# Step 2: After successful deploy, add domain
unset SKIP_DOMAIN
export DOMAIN_NAME=your-domain.com
pnpm sst deploy --stage staging
```

**Option B: Remove conflicting DNS records**
```bash
# List validation records
aws route53 list-resource-record-sets \
  --hosted-zone-id YOUR_ZONE_ID \
  --query "ResourceRecordSets[?contains(Name, '_')]"

# Delete the specific CNAME
aws route53 change-resource-record-sets \
  --hosted-zone-id YOUR_ZONE_ID \
  --change-batch file://delete-cname.json
```

**See**: `DEPLOYMENT_FIX.md` for detailed resolution steps

#### 2. Lambda Cold Starts (>10 seconds)

**Error**: Slow initial response time after no traffic

**Symptoms**:
- First request takes 10-15 seconds
- Subsequent requests are fast (< 500ms)
- CloudWatch logs show long Lambda init time

**Solutions**:

1. **Check bundle size**:
   ```bash
   # View .next/standalone size
   du -sh apps/web/.next/standalone
   # Should be < 50MB
   ```

2. **Enable webpack optimization**:
   - Check `next.config.mjs` has webpack optimization enabled
   - Remove `webpack: false` if present

3. **Increase Lambda memory**:
   ```typescript
   // sst.config.ts
   transform: {
     server: {
       memory: "2048 MB", // More memory = faster CPU
     },
   },
   ```

4. **Use provisioned concurrency** (costs extra):
   ```bash
   aws lambda put-provisioned-concurrency-config \
     --function-name my-saas-main \
     --provisioned-concurrent-executions 1
   ```

#### 3. Email Sending Fails - "Email address not verified"

**Error**: `MessageRejected: Email address is not verified`

**Cause**: AWS SES is in sandbox mode or domain not verified

**Solutions**:

1. **Verify domain identity**:
   ```bash
   # Check verification status
   aws sesv2 get-email-identity \
     --email-identity your-domain.com \
     --query 'VerifiedForSendingStatus'

   # Should return true
   ```

2. **Check DNS records**:
   - DKIM records (3 CNAME records)
   - SPF record (TXT record)
   - DMARC record (optional but recommended)

3. **Move out of SES sandbox**:
   ```bash
   # Request production access
   # Go to AWS Console → SES → Account Dashboard → Request Production Access
   # Typical approval time: 24-48 hours
   ```

4. **Verify individual emails (sandbox workaround)**:
   ```bash
   aws sesv2 create-email-identity \
     --email-identity test@example.com
   # Check email for verification link
   ```

#### 4. Messages Stuck in Dead Letter Queue

**Symptoms**:
- Emails not sending
- CloudWatch shows "MAX RETRIES REACHED"
- DLQ has messages

**Investigation**:

1. **Check DLQ message count**:
   ```bash
   aws sqs get-queue-attributes \
     --queue-url https://sqs.us-east-1.amazonaws.com/123/EmailDLQ \
     --attribute-names ApproximateNumberOfMessages
   ```

2. **View failed messages**:
   ```bash
   aws sqs receive-message \
     --queue-url https://sqs.us-east-1.amazonaws.com/123/EmailDLQ \
     --max-number-of-messages 10
   ```

3. **Check email worker logs**:
   ```bash
   aws logs tail /aws/lambda/email-worker --follow
   ```

**Common Causes**:
- Invalid email format
- SES sandbox restrictions
- Missing environment variables
- Network issues

**Resolution**:
1. Fix the root cause (check logs)
2. Manually reprocess messages:
   ```bash
   # Get message from DLQ
   # Fix the issue
   # Resend to main queue
   aws sqs send-message \
     --queue-url https://sqs.us-east-1.amazonaws.com/123/EmailQueue \
     --message-body "$FIXED_MESSAGE"
   ```

#### 5. "Module not found" in Lambda

**Error**: `Cannot find module '@aws-sdk/client-sesv2'`

**Cause**: Missing Lambda layer or incorrect bundling

**Solutions**:

1. **Check SST nodejs.install**:
   ```typescript
   // sst.config.ts - email worker
   nodejs: {
     install: [
       "@supabase/supabase-js",
       "@aws-sdk/client-sesv2",
     ],
   },
   ```

2. **Verify package.json has dependencies**:
   ```bash
   grep "@aws-sdk/client-sesv2" apps/web/package.json
   ```

3. **Redeploy with clean build**:
   ```bash
   rm -rf apps/web/.next
   rm -rf apps/web/.open-next
   pnpm sst deploy --stage staging
   ```

### Infrastructure Configuration Issues

#### 6. "Invalid Supabase URL" Error

**Error**: Runtime error with Zod validation failing

**Cause**: Missing or malformed environment variables

**Solution**:

1. **Check environment variables**:
   ```bash
   # Locally
   echo $NEXT_PUBLIC_SUPABASE_URL

   # In Lambda
   aws lambda get-function-configuration \
     --function-name my-saas-main \
     --query 'Environment.Variables.NEXT_PUBLIC_SUPABASE_URL'
   ```

2. **Validate format**:
   - Supabase URL: Must be `https://*.supabase.co`
   - PostgreSQL host: Must not be empty
   - Port: Must be a number

3. **Update Lambda config**:
   ```bash
   aws lambda update-function-configuration \
     --function-name my-saas-main \
     --environment "Variables={
       NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co,
       ...
     }"
   ```

### Database Issues

#### 7. Database Connection Failed

**Error**: `ECONNREFUSED` or `Connection timeout`

**Solutions**:
- Check security groups allow Lambda IP ranges
- Verify RDS is not publicly accessible but Lambda is in same VPC
- Test connection:
  ```bash
  psql -h $POSTGRES_HOST -U $POSTGRES_USER -d $POSTGRES_DB
  ```

#### 8. Migration Errors

**Error**: `relation "accounts" does not exist`

**Cause**: Migrations not applied to production database

**Solution**:

1. **Verify migrations in Supabase**:
   ```bash
   supabase db remote list
   ```

2. **Apply pending migrations**:
   ```bash
   # Option 1: Supabase CLI
   supabase db push --linked

   # Option 2: Manual SQL
   psql $DATABASE_URL < apps/web/supabase/migrations/*.sql
   ```

### Performance Issues

#### 9. Lambda Timeout

**Error**: `Task timed out after 30.00 seconds`

**Solutions**:
- Increase Lambda timeout (max 900s):
  ```bash
  aws lambda update-function-configuration \
    --function-name my-saas-main \
    --timeout 60
  ```
- Optimize cold starts:
  - Enable Lambda SnapStart
  - Increase memory (faster CPU)
  - Use provisioned concurrency

#### 10. CORS Errors

**Error**: `Access to fetch blocked by CORS policy`

**Solutions**:
- Update S3 CORS configuration
- Add domain to API Gateway CORS settings
- Check CloudFront origin configuration

### Authentication Issues

#### 11. Auth Issues After Migration

**Error**: Users can't log in after switching providers

**Solutions**:
- Send password reset emails to all users
- Implement session migration:
  ```typescript
  // Migrate session on first login
  if (isOldProvider(session)) {
    await migrateToNewProvider(session);
  }
  ```

### Cost Optimization

#### 12. High AWS Costs

**Monitoring**:
```bash
# Check costs
aws ce get-cost-and-usage \
  --time-period Start=2024-01-01,End=2024-01-31 \
  --granularity MONTHLY \
  --metrics UnblendedCost \
  --group-by Type=SERVICE
```

**Optimization**:
- Enable Lambda SnapStart
- Use S3 Intelligent-Tiering
- Enable RDS Auto Scaling
- Set CloudFront TTL appropriately

**See**: `COSTS.md` for detailed cost breakdown and optimization strategies

---

## Provider Switching & Migration Guide

The platform's vendor-agnostic architecture allows switching providers without code changes. This section covers migration strategies for each service type.

### General Migration Principles

1. **Zero-Downtime Strategy**: Run old and new providers in parallel during cutover
2. **Gradual Rollout**: Test with percentage-based traffic routing
3. **Fallback Ready**: Keep old provider active until new provider is verified
4. **Data Sync**: Ensure data consistency during migration period
5. **Monitoring**: Track metrics for both providers during transition

### Cache Provider Migration

#### Scenario 1: Memory Cache → Redis (Upstash)

**Use Case**: Moving from development to production with shared cache

**Steps**:

1. **Setup Upstash**:
   ```bash
   # Sign up at upstash.com
   # Create Redis database (free tier: 10K commands/day)
   # Copy connection URL
   ```

2. **Update Environment Variables**:
   ```bash
   # Before (memory cache)
   CACHE_PROVIDER=memory

   # After (Upstash Redis)
   CACHE_PROVIDER=redis
   REDIS_URL=redis://default:password@your-redis.upstash.io:6379
   ```

3. **Deploy**:
   ```bash
   # No code changes needed - just redeploy
   pnpm sst deploy --stage production
   ```

4. **Verify Cache is Working**:
   ```bash
   # Check logs for Redis connection
   aws logs tail /aws/lambda/${STAGE}-Web-server --follow | grep -i redis

   # Should see: "Redis cache client initialized"
   # Monitor CloudWatch for cache hit rates
   ```

**Impact**: Immediate - cache is empty initially, will populate on first requests
**Rollback**: Change `CACHE_PROVIDER=memory` and redeploy (< 2 minutes)
**Cost**: Free (up to 10K commands/day)

---

#### Scenario 2: Upstash → ElastiCache

**Use Case**: High traffic production requiring VPC-based Redis with lower latency

**Prerequisites**:
- VPC with subnets in multiple AZs
- Lambda functions deployed in VPC
- Security groups configured

**Steps**:

1. **Provision ElastiCache** (via SST):
   ```bash
   # Add to .env
   CACHE_PROVIDER=redis
   USE_ELASTICACHE=true
   VPC_ID=vpc-xxxxx
   SUBNET_IDS=subnet-xxxxx,subnet-yyyyy
   VPC_CIDR=10.0.0.0/16
   ```

2. **Deploy Infrastructure**:
   ```bash
   pnpm sst deploy --stage production
   # Wait 10-15 minutes for ElastiCache provisioning
   ```

3. **Parallel Testing** (keep Upstash active):
   ```bash
   # Test ElastiCache endpoint
   redis-cli -h your-elasticache-endpoint.cache.amazonaws.com ping
   # Should return: PONG
   ```

4. **Switch Traffic**:
   ```bash
   # Remove REDIS_URL from environment (use ElastiCache endpoint from SST)
   # Redeploy
   pnpm sst deploy --stage production
   ```

5. **Monitor Performance**:
   ```bash
   # Check ElastiCache metrics in CloudWatch
   # - CacheHits vs CacheMisses
   # - NetworkBytesIn/Out
   # - CPUUtilization (should be < 60%)
   ```

6. **Decommission Upstash**:
   ```bash
   # After 24-48 hours of stable operation
   # Delete Upstash database from dashboard
   ```

**Migration Time**: 1-2 hours
**Rollback**: Set `REDIS_URL` back to Upstash and redeploy
**Cost Change**: Free → $12/month (cache.t4g.micro)

---

### Email Provider Migration

#### Scenario 1: Resend → AWS SES

**Use Case**: Scaling beyond Resend's free tier (3K emails/month) or needing AWS integration

**Steps**:

1. **Setup AWS SES**:
   ```bash
   # Verify domain
   aws sesv2 create-email-identity --email-identity your-domain.com

   # Add DNS records for verification (see output)
   # Wait 24-72 hours for verification

   # Check status
   aws sesv2 get-email-identity \
     --email-identity your-domain.com \
     --query 'VerifiedForSendingStatus'
   ```

2. **Parallel Testing** (keep Resend active):
   ```bash
   # Add SES config but keep EMAIL_PROVIDER=resend
   AWS_SES_CONFIG_SET=your-config-set

   # Test SES manually
   aws sesv2 send-email \
     --from-email-address noreply@your-domain.com \
     --destination ToAddresses=test@example.com \
     --content 'Simple={Subject={Data="Test"},Body={Text={Data="Test email"}}}'
   ```

3. **Gradual Cutover** (route percentage of traffic):
   ```typescript
   // apps/web/lambda/email-worker/index.ts
   const useNewProvider = Math.random() < 0.1; // 10% to SES
   const provider = useNewProvider ? 'ses' : 'resend';
   ```

4. **Full Switchover**:
   ```bash
   # After 24 hours of successful testing at 100%
   EMAIL_PROVIDER=ses
   # Remove RESEND_API_KEY
   ```

5. **Monitor Deliverability**:
   ```bash
   # Check SES bounce/complaint rates in CloudWatch
   aws cloudwatch get-metric-statistics \
     --namespace AWS/SES \
     --metric-name Reputation.BounceRate \
     --start-time 2024-01-01T00:00:00Z \
     --end-time 2024-01-31T23:59:59Z \
     --period 86400 \
     --statistics Average
   ```

**Migration Time**: 2-3 days (includes DNS propagation)
**Rollback**: Change `EMAIL_PROVIDER=resend` and redeploy
**Cost Change**: Free (3K/month) → $0.10 per 1K emails

---

#### Scenario 2: SES → SendGrid/Mailgun

**Use Case**: Needing better email analytics or different geographic coverage

**Steps**:

1. **Setup New Provider**:
   ```bash
   # Sign up for SendGrid/Mailgun
   # Verify domain
   # Get API key
   ```

2. **Update Environment Variables**:
   ```bash
   EMAIL_PROVIDER=sendgrid  # or 'mailgun'
   SENDGRID_API_KEY=SG.xxxxxxxxxxxxx
   EMAIL_SENDER=noreply@your-domain.com
   ```

3. **Deploy and Verify**:
   ```bash
   pnpm sst deploy --stage production

   # Send test email via API
   curl -X POST https://your-domain.com/api/test-email
   ```

**Migration Time**: 1-2 hours
**Rollback**: Change `EMAIL_PROVIDER=ses` and redeploy

---

### Storage Provider Migration

#### Scenario 1: Supabase Storage → AWS S3

**Use Case**: Scaling storage beyond Supabase limits or reducing costs at scale

**⚠️ Important**: This requires data migration - not just configuration change

**Steps**:

1. **Provision S3 Bucket**:
   ```bash
   # Create bucket
   aws s3api create-bucket \
     --bucket my-saas-storage \
     --region us-east-1

   # Enable versioning
   aws s3api put-bucket-versioning \
     --bucket my-saas-storage \
     --versioning-configuration Status=Enabled

   # Configure CORS (see AWS Deployment section for config)
   ```

2. **Data Migration** (run from EC2 or local with good bandwidth):
   ```typescript
   // migration-script.ts
   import { createClient } from '@supabase/supabase-js';
   import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

   const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
   const s3 = new S3Client({ region: 'us-east-1' });

   async function migrateFiles() {
     // List all files from Supabase Storage
     const { data: files } = await supabase
       .storage
       .from('your-bucket')
       .list();

     for (const file of files) {
       // Download from Supabase
       const { data: blob } = await supabase
         .storage
         .from('your-bucket')
         .download(file.name);

       // Upload to S3
       await s3.send(new PutObjectCommand({
         Bucket: 'my-saas-storage',
         Key: file.name,
         Body: blob,
       }));

       console.log(`Migrated: ${file.name}`);
     }
   }
   ```

3. **Parallel Run** (write to both, read from S3):
   ```bash
   # Update environment
   STORAGE_PROVIDER=r2
   S3_BUCKET=my-saas-storage

   # Keep Supabase config active for fallback
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   ```

4. **Verify Migration**:
   ```bash
   # Compare file counts
   aws s3 ls s3://my-saas-storage --recursive | wc -l
   # Should match Supabase file count
   ```

5. **Full Cutover**:
   ```bash
   # After 7 days of successful operation
   # Stop writing to Supabase Storage
   # Update code to remove Supabase Storage client
   ```

6. **Cleanup**:
   ```bash
   # Delete Supabase Storage bucket (optional)
   # This frees up storage quota
   ```

**Migration Time**: 3-5 days (depends on data volume)
**Rollback**: Change `STORAGE_PROVIDER=supabase` and redeploy
**Data Safety**: Keep Supabase storage active for 30 days after cutover

---

### Database Provider Migration

#### Scenario 1: Supabase → AWS RDS PostgreSQL

**Use Case**: Moving to self-managed database for compliance or cost optimization

**⚠️ CRITICAL**: This is the most complex migration - plan for maintenance window

**Steps**:

1. **Provision RDS**:
   ```bash
   # Create RDS instance (see AWS Deployment section)
   # Use same PostgreSQL version as Supabase
   ```

2. **Schema Migration**:
   ```bash
   # Export schema from Supabase
   pg_dump $SUPABASE_CONNECTION_STRING --schema-only > schema.sql

   # Import to RDS
   psql $RDS_CONNECTION_STRING < schema.sql
   ```

3. **Data Migration**:
   ```bash
   # Option A: pg_dump/restore (requires downtime)
   pg_dump $SUPABASE_CONNECTION_STRING \
     --data-only \
     --exclude-table-data=_realtime.* \
     --exclude-table-data=storage.* \
     > data.sql

   psql $RDS_CONNECTION_STRING < data.sql

   # Option B: Logical replication (zero downtime)
   # 1. Setup publication on Supabase
   # 2. Setup subscription on RDS
   # 3. Wait for sync
   # 4. Switch application connection
   ```

4. **Update Environment Variables**:
   ```bash
   # Before
   DATABASE_PROVIDER=supabase
   NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co

   # After
   DATABASE_PROVIDER=postgresql
   POSTGRES_HOST=your-db.xxxxx.us-east-1.rds.amazonaws.com
   POSTGRES_PORT=5432
   POSTGRES_DB=postgres
   POSTGRES_USER=admin
   POSTGRES_PASSWORD=xxxxx
   ```

5. **Update Auth Provider** (if using Supabase Auth):
   ```bash
   # Must also migrate auth provider
   AUTH_PROVIDER=cognito  # or clerk, auth0
   # See Auth migration section below
   ```

6. **Deploy and Test**:
   ```bash
   pnpm sst deploy --stage production

   # Smoke test critical paths
   curl https://your-domain.com/api/healthcheck
   ```

7. **Monitor** (keep Supabase active for 7 days):
   - Database connection pool usage
   - Query performance (compare to Supabase)
   - Error rates
   - Memory/CPU utilization

**Migration Time**: 1-2 days (with logical replication) or 4-8 hours (with downtime)
**Rollback**: Change `DATABASE_PROVIDER=supabase` and redeploy (< 5 minutes)
**Risk**: High - involves data and auth migration

---

### Cache Invalidation Strategy

**Important**: When switching cache providers, the cache will be empty initially. This is expected behavior.

**Automatic Invalidation**:
- Cache entries expire after 5 minutes (TTL)
- Role/permission changes trigger immediate invalidation

**Manual Invalidation** (if needed):
```typescript
import { invalidateAuthCache } from '~/lib/database/authorization';

// Invalidate specific user's cache
await invalidateAuthCache(userId, accountId);

// Or flush entire cache (if using Redis)
import { createCacheClient } from '@kit/cache';
const cache = createCacheClient();
await cache.clear(); // Flushes all keys
```

---

### Migration Checklist

Before switching any provider:

- [ ] **Backup**: Export current data/configuration
- [ ] **Test Environment**: Validate new provider in staging first
- [ ] **Monitoring**: Setup alerts for new provider metrics
- [ ] **Documentation**: Update team runbooks with new provider details
- [ ] **Access**: Ensure team has credentials for new provider
- [ ] **Budget**: Approve new provider costs
- [ ] **Rollback Plan**: Document exact steps to revert
- [ ] **Communication**: Notify team of migration window
- [ ] **Health Checks**: Verify all endpoints return 200 after migration

---

### Cost Optimization Migration Paths

**Development → Production**:
```
Memory Cache → Upstash Redis (free)
Resend Email (free) → Keep Resend (cheap at scale)
Supabase Storage → Supabase Storage (upgrade tier)
```

**Production → Scale**:
```
Upstash Redis → ElastiCache (better performance)
Resend Email → AWS SES (cheaper at volume)
Supabase Storage → S3 (cheaper at 100GB+)
```

**Cost Impact**:
| Migration Path | Before | After | Savings |
|----------------|--------|-------|---------|
| Upstash → Memory (dev) | Free | Free | $0 |
| ElastiCache → Upstash (staging) | $12/mo | Free | $12/mo |
| Resend → SES (100K emails) | $160/mo | $10/mo | $150/mo |
| Supabase Storage → S3 (500GB) | $250/mo | $11.50/mo | $238.50/mo |

---

## Rollback Procedures

### Quick Rollback (< 5 minutes)

**For bad deployments with functional issues:**

1. **Revert Lambda to previous version**:
   ```bash
   # List versions
   aws lambda list-versions-by-function \
     --function-name my-saas-main

   # Update alias to previous version
   aws lambda update-alias \
     --function-name my-saas-main \
     --name live \
     --function-version 42  # Previous working version
   ```

2. **Update CloudFront to use previous Lambda**:
   ```bash
   aws cloudfront update-distribution \
     --id YOUR_DIST_ID \
     --distribution-config file://previous-config.json
   ```

3. **Verify**:
   ```bash
   curl https://your-domain.com/api/health
   ```

### Full Rollback (15-30 minutes)

**For infrastructure changes or major issues:**

1. **Revert git commit**:
   ```bash
   # Find the commit hash of last working deploy
   git log --oneline

   # Revert to that commit
   git revert HEAD --no-commit
   git commit -m "Rollback: revert to working version"
   git push origin main
   ```

2. **Trigger manual deployment**:
   ```bash
   # Go to GitHub Actions UI
   # Run deploy-aws-production workflow manually
   ```

3. **Monitor deployment**:
   ```bash
   gh run watch

   # Check health
   curl https://your-domain.com/api/health
   ```

### Database Rollback

**⚠️ CAUTION**: Database rollbacks are destructive and may cause data loss

1. **For Supabase**:
   ```bash
   # Revert migration
   supabase db reset

   # Or manually rollback specific migration
   psql $DATABASE_URL -c "DROP TABLE IF EXISTS new_table;"
   ```

2. **For AWS RDS**:
   ```bash
   # Restore from automated backup
   aws rds restore-db-instance-to-point-in-time \
     --source-db-instance-identifier my-saas-db \
     --target-db-instance-identifier my-saas-db-restored \
     --restore-time 2024-01-15T10:00:00Z
   ```

### Emergency Maintenance Mode

**If rollback fails, enable maintenance mode:**

1. **Add CloudFront Lambda@Edge function**:
   ```javascript
   // maintenance.js
   exports.handler = async (event) => {
     return {
       status: '503',
       statusDescription: 'Service Unavailable',
       body: 'We are currently performing maintenance. Please check back soon.',
     };
   };
   ```

2. **Or use static S3 page**:
   ```bash
   # Upload maintenance page
   aws s3 cp maintenance.html s3://my-bucket/maintenance.html

   # Update CloudFront to serve from S3
   ```

---

## Monitoring & Alerts

### Health Checks

```typescript
// apps/web/app/healthcheck/route.ts
export async function GET() {
  const checks = {
    database: await checkDatabase(),
    storage: await checkStorage(),
    queue: await checkQueue(),
  };

  const healthy = Object.values(checks).every(Boolean);

  return Response.json(
    { status: healthy ? 'healthy' : 'unhealthy', checks },
    { status: healthy ? 200 : 503 }
  );
}
```

### Metrics to Track

- Response time (p50, p95, p99)
- Error rate
- Database connection pool usage
- Lambda cold starts
- CloudFront cache hit ratio
- S3 storage costs

### Recommended Tools

- **Sentry**: Error tracking
- **DataDog / New Relic**: APM
- **CloudWatch**: AWS metrics
- **Vercel Analytics**: Web vitals

---

## Production Deployment Checklist

Before going live:

- [ ] Load testing completed (min 1000 concurrent users)
- [ ] Security audit passed
- [ ] Backup strategy implemented
- [ ] Disaster recovery plan documented
- [ ] Monitoring and alerts configured
- [ ] SSL/TLS certificates valid
- [ ] CDN configured and tested
- [ ] Database indexes optimized
- [ ] Environment variables secured
- [ ] CI/CD pipeline tested
- [ ] Rollback plan documented
- [ ] Support team trained
- [ ] Documentation updated

---

## Support

For deployment issues:
1. Check this guide first
2. Review `SUPABASE_VENDOR_LOCKIN_REPORT.md` for migration details
3. Check `apps/web/lib/infrastructure/README.md` for provider configuration
4. Open an issue in the repository

---

**Congratulations!** 🎉 Your vendor-agnostic SaaS is now deployed!

*Last updated: January 2025*
