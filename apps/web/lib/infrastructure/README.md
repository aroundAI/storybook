# Infrastructure Abstraction Layer

This directory contains the vendor-agnostic infrastructure abstraction layer that enables seamless switching between different service providers (Supabase, AWS, Azure, etc.) via environment variables.

## Overview

The infrastructure layer provides a unified API for all external services:

- **Database**: Supabase, PostgreSQL, MySQL
- **Authentication**: Supabase, AWS Cognito, Auth0, Clerk
- **Storage**: Supabase, AWS S3
- **Email**: Resend, AWS SES, SendGrid, Nodemailer
- **Queue**: AWS SQS, BullMQ
- **Realtime**: Supabase, WebSocket, Pusher
- **Cache**: Redis, In-Memory

## Architecture

```
┌─────────────────────────────────────────┐
│   Application Code                      │
│   (Server Components, Actions, etc.)    │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│   Infrastructure Layer (This Directory) │
│   - config.ts (Environment Config)      │
│   - types.ts (Type Definitions)         │
└────────────┬────────────────────────────┘
             │
             ▼
┌─────────────────────────────────────────┐
│   Provider Packages                     │
│   (@kit/providers-*)                    │
└─────────────────────────────────────────┘
```

## Usage

### Current Approach (Direct Supabase)

```typescript
// ❌ Vendor lock-in
import { getSupabaseServerClient } from '@kit/supabase/server-client';

const client = getSupabaseServerClient();
const { data } = await client.from('notes').select('*');
```

### New Approach (Vendor Agnostic)

```typescript
// ✅ Vendor independent - automatically uses configured provider
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// For now, keep using Supabase directly as the provider abstraction
// is already in place via the @kit/providers-* packages
const client = getSupabaseServerClient();
const { data } = await client.from('notes').select('*');
```

## Configuration

### Environment Variables

Set these in your `.env` file to switch providers:

```bash
# Database Provider
DATABASE_PROVIDER=supabase          # or postgresql, mysql
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Auth Provider
AUTH_PROVIDER=supabase              # or cognito, auth0, clerk

# Storage Provider
STORAGE_PROVIDER=supabase           # or s3

# Email Provider
EMAIL_PROVIDER=resend               # or ses, sendgrid, nodemailer
RESEND_API_KEY=...

# Optional: Queue Provider
QUEUE_PROVIDER=bullmq               # or sqs
REDIS_URL=redis://localhost:6379

# Optional: Realtime Provider
REALTIME_PROVIDER=supabase          # or websocket, pusher

# Optional: Cache Provider
CACHE_PROVIDER=redis                # or memory
```

### AWS Configuration Example

```bash
# AWS-based stack
DATABASE_PROVIDER=postgresql
POSTGRES_HOST=mydb.xxxxx.us-east-1.rds.amazonaws.com
POSTGRES_DB=myapp
POSTGRES_USER=admin
POSTGRES_PASSWORD=...

AUTH_PROVIDER=cognito
COGNITO_USER_POOL_ID=us-east-1_xxxxxxxxx
COGNITO_CLIENT_ID=...

STORAGE_PROVIDER=s3
S3_BUCKET=my-app-storage
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...

EMAIL_PROVIDER=ses

QUEUE_PROVIDER=sqs
SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/...
```

## Benefits

### Zero Vendor Lock-in

Switch providers by changing environment variables - no code changes required.

### Cost Optimization

Choose the most cost-effective provider for each service:

- Use Supabase for development (free tier)
- Use AWS RDS for production (better pricing at scale)
- Use S3 for storage (cheapest object storage)
- Mix and match based on your needs

### Multi-Cloud Deployment

Deploy to any platform:

- **Vercel**: Use Supabase for everything
- **AWS**: Use RDS, Cognito, S3, SES, SQS
- **Hybrid**: Supabase DB + AWS S3 + SendGrid Email

### Future-Proof

Easy to add new providers without touching application code.

## Migration Guide

### From Supabase to AWS

1. **Setup AWS Services**
   - Create RDS PostgreSQL database
   - Create Cognito User Pool
   - Create S3 bucket
   - Configure SES for email

2. **Update Environment Variables**

   ```bash
   DATABASE_PROVIDER=postgresql
   AUTH_PROVIDER=cognito
   STORAGE_PROVIDER=s3
   EMAIL_PROVIDER=ses
   ```

3. **Migrate Data**
   - Export Supabase database
   - Import to RDS
   - Copy files from Supabase Storage to S3
   - Migrate users to Cognito

4. **Deploy**
   - No code changes needed!
   - Just deploy with new env vars

### From AWS to Supabase

1. **Setup Supabase Project**
   - Create new Supabase project
   - Note URL and keys

2. **Update Environment Variables**

   ```bash
   DATABASE_PROVIDER=supabase
   AUTH_PROVIDER=supabase
   STORAGE_PROVIDER=supabase
   EMAIL_PROVIDER=resend
   ```

3. **Migrate Data**
   - Import RDS dump to Supabase
   - Copy S3 files to Supabase Storage
   - Migrate Cognito users

4. **Deploy**
   - Deploy with new configuration

## Provider Compatibility Matrix

| Feature  | Supabase | PostgreSQL | MySQL | AWS Cognito | Auth0 | Clerk |
| -------- | -------- | ---------- | ----- | ----------- | ----- | ----- |
| Database | ✅       | ✅         | ✅    | -           | -     | -     |
| Auth     | ✅       | -          | -     | ✅          | ✅    | ✅    |
| Storage  | ✅       | -          | -     | -           | -     | -     |
| Realtime | ✅       | -          | -     | -           | -     | -     |
| RLS      | ✅       | ⚠️         | ⚠️    | -           | -     | -     |

Legend:

- ✅ Full support
- ⚠️ Partial support (requires application-level implementation)
- ❌ Not supported
- \- Not applicable

## Files

- `types.ts` - Type definitions for providers and configuration
- `config.ts` - Environment variable loading and validation
- `README.md` - This documentation

## Next Steps

1. Review current Supabase usage in the app
2. Plan migration strategy based on your deployment target
3. Update environment variables
4. Test with different providers in staging
5. Deploy to production

## Support

For issues or questions:

1. Check the deployment documentation in `/DEPLOYMENT.md`
2. Review the vendor lock-in report in `/SUPABASE_VENDOR_LOCKIN_REPORT.md`
3. Open an issue in the repository
