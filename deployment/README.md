# AWS Lambda Deployment Guide

This guide explains how to deploy your SaaS application to AWS Lambda using SST (Serverless Stack).

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Quick Start](#quick-start)
3. [Configuration](#configuration)
4. [Deployment Commands](#deployment-commands)
5. [Domain Setup](#domain-setup)
6. [Post-Deployment](#post-deployment)
7. [Troubleshooting](#troubleshooting)

## Prerequisites

### Required Software

- **Node.js** >= v18.18.0
- **pnpm** >= 10.14.0
- **AWS CLI** v2
- **Supabase CLI** (optional, for automatic migrations)

Install missing tools:

```bash
# Install pnpm
npm install -g pnpm

# Install AWS CLI
# macOS
brew install awscli

# Linux
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
unzip awscliv2.zip
sudo ./aws/install

# Windows
# Download from: https://awscli.amazonaws.com/AWSCLIV2.msi

# Install Supabase CLI (optional)
npm install -g supabase
```

### AWS Account Setup

1. **Create AWS Account**: [aws.amazon.com](https://aws.amazon.com)

2. **Configure AWS CLI**:
```bash
aws configure
# Enter:
# - AWS Access Key ID
# - AWS Secret Access Key
# - Default region (e.g., us-east-1)
# - Default output format (json)
```

3. **Verify Configuration**:
```bash
aws sts get-caller-identity
# Should return your AWS account details
```

### Supabase Setup

1. **Create Supabase Project**: [supabase.com/dashboard](https://supabase.com/dashboard)

2. **Get Credentials**:
   - Project URL: `https://your-project.supabase.co`
   - Anon Key: Project Settings → API → anon (public)
   - Service Role Key: Project Settings → API → service_role (secret)
   - Project Ref: Project Settings → General → Reference ID
   - Database Password: Project Settings → Database → Password

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Initialize Deployment Config

`deployment/config` is a git submodule that points to `aroundAI/storybook-deployment-config`.

```bash
git submodule update --init --recursive deployment/config
```

To pull the latest config changes from that repo:

```bash
git submodule update --remote --merge deployment/config
```

### 3. Edit Configuration

Edit `deployment/config/[stage].env` and fill in your credentials (these files are owned by the `storybook-deployment-config` repo):

```bash
# Required
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# Optional (for custom domain)
DOMAIN_NAME=yourdomain.com

# Optional (for automatic migrations)
SUPABASE_PROJECT_REF=abcdefghij
SUPABASE_DB_PASSWORD=your-password
SUPABASE_ACCESS_TOKEN=sbp_...
```

### 4. Deploy

```bash
# Deploy to staging
pnpm deploy:staging

# Deploy to production
pnpm deploy:production

# Deploy to custom stage
./scripts/deploy.sh yourstage
```

The script will:
1. ✅ Check prerequisites (AWS CLI, Node.js, pnpm)
2. ✅ Load environment variables
3. ✅ Configure domain (if DOMAIN_NAME is set)
4. ✅ Install dependencies
5. ✅ Apply Supabase migrations (if configured)
6. ✅ Build Next.js application
7. ✅ Deploy to AWS Lambda via SST
8. ✅ Set up CloudFront CDN
9. ✅ Configure AWS SES for email (if domain is set)
10. ✅ Run post-deployment health checks

## Configuration

### Environment Variables

#### Required Variables

```bash
# Supabase Configuration
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

#### Optional Variables

```bash
# AWS Region
AWS_REGION=us-east-1

# Custom Domain
DOMAIN_NAME=yourdomain.com
HOSTED_ZONE_ID=Z1234567890ABC  # Auto-discovered if not set
SKIP_DOMAIN=false  # Set to true to skip domain setup

# Supabase Migrations (recommended for production)
SUPABASE_PROJECT_REF=abcdefghij
SUPABASE_DB_PASSWORD=your-password
SUPABASE_ACCESS_TOKEN=sbp_...

# Site Configuration
NEXT_PUBLIC_SITE_URL=https://yourdomain.com
NEXT_PUBLIC_PRODUCT_NAME=Your SaaS
NEXT_PUBLIC_SITE_DESCRIPTION=Your description

# Email Configuration
EMAIL_PROVIDER=ses
EMAIL_SENDER=noreply@yourdomain.com

# Infrastructure Providers
STORAGE_PROVIDER=s3
QUEUE_PROVIDER=sqs
REALTIME_PROVIDER=websocket
```

### Configuration Files

| File | Purpose |
|------|---------|
| `deployment/config/*.env` | Stage-specific deployment variables (from submodule) |
| `sst.config.ts` | SST infrastructure configuration |

### Config Repository Sync Workflow

`deployment/config` is its own repository tracked by the parent repo as a submodule.

Pull latest config updates from `aroundAI/storybook-deployment-config`:

```bash
git submodule update --remote --merge deployment/config
git add deployment/config
git commit -m "chore: bump deployment config submodule"
```

Push config edits to the config repo:

```bash
cd deployment/config
git add .
git commit -m "chore: update production env"
git push origin main
cd ../..
git add deployment/config
git commit -m "chore: bump deployment config submodule"
```

## Deployment Commands

### Using npm/pnpm Scripts

```bash
# Deploy to staging
pnpm deploy:staging

# Deploy to production
pnpm deploy:production

# General deploy (defaults to staging)
pnpm deploy

# SST-specific commands
pnpm sst deploy --stage staging
pnpm sst console --stage staging
pnpm sst logs --stage staging
pnpm sst remove --stage staging
```

Use `pnpm deploy:staging` / `pnpm deploy:production` for normal deployments because the deploy script loads `deployment/config/[stage].env` automatically. If running `pnpm sst deploy --stage ...` directly, export env vars first in your shell.

### Using Deploy Script Directly

```bash
# Deploy to staging
./scripts/deploy.sh staging

# Deploy to production
./scripts/deploy.sh production

# Deploy to custom stage
./scripts/deploy.sh custom-stage-name
```

### SST Commands

```bash
# Deploy infrastructure
pnpm sst deploy --stage [stage]

# View logs
pnpm sst logs --stage [stage]

# Open SST console
pnpm sst console --stage [stage]

# Remove infrastructure
pnpm sst remove --stage [stage]
```

## Domain Setup

### Option 1: Automatic Domain Configuration

The deploy script automatically:
1. Discovers your Route53 hosted zone
2. Creates CloudFront distribution
3. Sets up SES for email sending
4. Creates DNS records (A, CNAME, MX, TXT for DKIM/SPF)

**Requirements**:
- Route53 hosted zone for your domain
- `DOMAIN_NAME` set in config

```bash
# deployment/config/production.env
DOMAIN_NAME=yourdomain.com
```

### Option 2: Manual Domain Setup

If you prefer manual setup or use external DNS:

1. **Deploy without domain**:
```bash
SKIP_DOMAIN=true pnpm deploy:production
```

2. **Get CloudFront URL** from deployment output

3. **Create DNS records**:
   - CNAME: `yourdomain.com` → `d1234567890.cloudfront.net`
   - For root domain, use ALIAS record in Route53 or CNAME flattening

### Create Route53 Hosted Zone

If you don't have a hosted zone:

```bash
# Create hosted zone
aws route53 create-hosted-zone \
  --name yourdomain.com \
  --caller-reference $(date +%s)

# Get nameservers
aws route53 get-hosted-zone --id Z1234567890ABC \
  --query "DelegationSet.NameServers"

# Update your domain registrar's nameservers
```

### Find Existing Hosted Zone

```bash
# Using helper script
./scripts/find-hosted-zone.sh yourdomain.com

# Or manually
aws route53 list-hosted-zones
```

## Post-Deployment

### Verify Deployment

1. **Check Application URL**:
```bash
# From deployment output
https://d1234567890.cloudfront.net
# or
https://yourdomain.com
```

2. **Test Health Check**:
```bash
curl https://yourdomain.com/api/health
```

3. **Check SST Console**:
```bash
pnpm sst console --stage production
```

### View Logs

```bash
# View all logs
pnpm sst logs --stage production

# View specific function logs
pnpm sst logs --stage production --fn Web

# Follow logs in real-time
pnpm sst logs --stage production --tail
```

### AWS Resources Created

SST creates the following resources:

| Resource | Purpose | Cost |
|----------|---------|------|
| Lambda Functions | Next.js app, Email worker, WebSocket handlers | Pay per invocation |
| CloudFront Distribution | CDN for static assets and routing | Pay per data transfer |
| S3 Bucket | File storage | ~$0.023/GB/month |
| SQS Queue | Email job queue | ~$0.40/million requests |
| DynamoDB Table | WebSocket connections | Pay per request |
| API Gateway WebSocket | Realtime features | ~$1.00/million messages |
| SES Domain Identity | Email sending | $0.10/1000 emails |
| Route53 Records | DNS records | $0.50/hosted zone |

**Estimated Cost** for 10K users: **~$55-70/month**

## Troubleshooting

### Common Issues

#### 1. AWS Credentials Not Configured

**Error**: `Unable to locate credentials`

**Solution**:
```bash
aws configure
# Enter your AWS credentials
```

#### 2. Hosted Zone Not Found

**Error**: `Could not find Route53 hosted zone`

**Solution**:
```bash
# Option 1: Create hosted zone
aws route53 create-hosted-zone --name yourdomain.com --caller-reference $(date +%s)

# Option 2: Deploy without domain
SKIP_DOMAIN=true pnpm deploy
```

#### 3. Supabase Migrations Fail

**Error**: `Failed to link to Supabase project`

**Solution**:
```bash
# Ensure variables are set in deployment/config/[stage].env
SUPABASE_PROJECT_REF=your-ref
SUPABASE_DB_PASSWORD=your-password
SUPABASE_ACCESS_TOKEN=sbp_...

# Get access token from: https://supabase.com/dashboard/account/tokens
```

#### 4. Build Fails (Out of Memory)

**Error**: `JavaScript heap out of memory`

**Solution**:
```bash
# Already set in deploy script, but you can increase further:
export NODE_OPTIONS="--max-old-space-size=8192"
pnpm deploy
```

#### 5. SES Email Sending Fails

**Error**: `Email address not verified`

**Solution**:

For development/testing, SES is in sandbox mode. Verify recipient emails:

```bash
aws sesv2 create-email-identity --email-identity test@example.com
```

For production, request production access:
1. AWS Console → SES → Account Dashboard
2. Click "Request production access"
3. Fill out form and wait for approval (usually 24 hours)

#### 6. Lambda Timeout

**Error**: `Task timed out after 30.00 seconds`

**Solution**: Increase timeout in `sst.config.ts`:

```typescript
transform: {
  server: {
    timeout: "60 seconds", // Increase from 30s
  },
},
```

### Debug Logs

Enable verbose logging:

```bash
# View deployment logs
pnpm sst deploy --stage staging --verbose

# View function logs
pnpm sst logs --stage staging --tail

# Check CloudWatch logs
aws logs tail /aws/lambda/storybook-staging-Web --follow
```

### Clean Up

Remove all AWS resources:

```bash
# Remove staging environment
pnpm sst remove --stage staging

# Remove production environment
pnpm sst remove --stage production
```

**Note**: This removes all infrastructure but keeps:
- S3 bucket contents (if retention is enabled)
- DynamoDB tables (if retention is enabled)
- Route53 hosted zone

## Support

For issues or questions:

1. Check the [main documentation](../README.md)
2. Review [SST documentation](https://sst.dev/docs)
3. Check [AWS Lambda pricing](https://aws.amazon.com/lambda/pricing/)
4. Open an issue in the repository

## Next Steps

- [ ] Set up monitoring (CloudWatch, Sentry)
- [ ] Configure alerts (SNS topics)
- [ ] Set up CI/CD (GitHub Actions)
- [ ] Enable CloudWatch Log Insights
- [ ] Configure auto-scaling
- [ ] Set up staging → production promotion workflow
