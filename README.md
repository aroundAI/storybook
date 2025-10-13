# Makerkit - Vendor-Agnostic SaaS Starter Kit

**The only SaaS starter that lets you switch providers in minutes, not months.**

This is a Starter Kit for building SaaS applications with **zero vendor lock-in**. Built on Next.js 15, it supports multiple infrastructure providers that can be switched via environment variables - no code changes required.

## 🎯 Key Features

- ✅ **Vendor Agnostic**: Switch between Supabase, AWS, Auth0, Clerk via config
- 🚀 **Deploy Anywhere**: Vercel, AWS Lambda, or self-hosted
- 💰 **Cost Optimization**: Mix providers for best value (starting at $35/month)
- ⚡ **Next.js 15** with App Router and React 19
- 🎨 **Tailwind CSS 4** with Shadcn UI components
- 🔐 **Multi-provider Auth**: Supabase, AWS Cognito, Auth0, Clerk
- 💳 **Billing**: Stripe or Lemon Squeezy
- 📧 **Email**: Resend, AWS SES, SendGrid, Nodemailer
- 🗄️ **Database**: Supabase, PostgreSQL, MySQL
- 📦 **Storage**: Supabase, AWS S3
- 🔄 **Queue**: AWS SQS, BullMQ
- 💨 **Cache**: Redis, In-Memory
- 📊 **Monitoring**: Sentry, Baselime

## 🚀 Quick Start

### Choose Your Stack

```bash
# Option 1: Supabase (Fastest - 10 mins)
cp .env.supabase.example .env

# Option 2: AWS (Full Control - 2 hours)
cp .env.aws.example .env

# Option 3: Hybrid (Best Value - 1 hour)
cp .env.hybrid.example .env
```

### Install & Run

```bash
pnpm install
pnpm dev
```

Visit http://localhost:3000

## 📖 Documentation

- **[Deployment Guide](./DEPLOYMENT.md)** - Deploy to AWS, Vercel, or hybrid
- **[Vendor Lock-in Analysis](./SUPABASE_VENDOR_LOCKIN_REPORT.md)** - Migration paths and cost comparison
- **[Infrastructure README](./apps/web/lib/infrastructure/README.md)** - Provider configuration
- **[MakerKit Docs](https://makerkit.dev/docs/next-supabase-turbo/introduction)** - Original documentation

## 🏗️ Architecture

```
┌─────────────────────────────┐
│   Your Application Code     │
│   (No vendor-specific code) │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│  Infrastructure Abstraction │
│  (apps/web/lib/infrastructure) │
└──────────┬──────────────────┘
           │
           ▼
┌─────────────────────────────┐
│   Provider Packages         │
│   (@kit/providers-*)        │
│   - database                │
│   - auth                    │
│   - storage                 │
│   - email                   │
│   - queue                   │
└─────────────────────────────┘
```

## 💰 Cost Comparison

**10K Users, 50GB Storage, 100K Emails/month**

| Stack | Monthly Cost | Deploy Time | Best For |
|-------|--------------|-------------|----------|
| **Supabase** | $35 | 10 mins | MVPs, rapid development |
| **AWS** | $95 | 2-4 hours | Enterprise, scale, compliance |
| **Hybrid** | $37 | 1 hour | **Recommended** - best value |

See [SUPABASE_VENDOR_LOCKIN_REPORT.md](./SUPABASE_VENDOR_LOCKIN_REPORT.md) for detailed breakdown.

## 🔄 Switch Providers in Minutes

No code changes required - just update environment variables:

```bash
# Start with Supabase
DATABASE_PROVIDER=supabase
AUTH_PROVIDER=supabase
STORAGE_PROVIDER=supabase

# Scale to AWS
DATABASE_PROVIDER=postgresql
AUTH_PROVIDER=cognito
STORAGE_PROVIDER=s3

# Or mix for best value
DATABASE_PROVIDER=supabase      # Best DX
STORAGE_PROVIDER=s3             # Cheapest storage
EMAIL_PROVIDER=resend           # Free tier
```

## 🛠️ Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS 4 + Shadcn UI
- **Database**: Supabase / PostgreSQL / MySQL
- **Auth**: Supabase / AWS Cognito / Auth0 / Clerk
- **Storage**: Supabase / AWS S3
- **Email**: Resend / AWS SES / SendGrid
- **Payments**: Stripe / Lemon Squeezy
- **Monitoring**: Sentry / Baselime
- **Deployment**: Vercel / AWS Lambda / Docker

## 📦 Monorepo Structure

```
├── apps/
│   ├── web/                    # Main Next.js app
│   │   ├── lib/infrastructure/ # Provider abstraction layer
│   │   ├── lambda/             # AWS Lambda workers
│   │   └── supabase/           # Database migrations
│   └── e2e/                    # Playwright tests
├── packages/
│   ├── providers/              # Provider implementations
│   │   ├── auth/               # Auth providers
│   │   ├── database/           # Database providers
│   │   ├── storage/            # Storage providers
│   │   ├── email/              # Email providers
│   │   └── queue/              # Queue providers
│   ├── features/               # Feature packages
│   └── ui/                     # UI components
└── tooling/                    # Build tools
```

## 🚢 Deployment

### AWS (Recommended for Production)

```bash
# Setup AWS resources (one-time)
# See DEPLOYMENT.md for detailed guide

# Push to main branch
git push origin main

# GitHub Actions automatically deploys to AWS Lambda
```

### Vercel + Supabase (Fastest)

```bash
vercel deploy --prod
```

### Hybrid (Best Value)

Deploy frontend to Vercel, use AWS for storage/queue, Supabase for database.

See [DEPLOYMENT.md](./DEPLOYMENT.md) for complete guides.

## 🧪 Testing

```bash
# Unit tests
pnpm test

# E2E tests
pnpm --filter e2e test

# Database tests
pnpm supabase:web:test

# Type checking
pnpm typecheck
```

## 🔐 Security

- Row Level Security (RLS) on Supabase
- Application-level authorization for other providers
- Secure environment variable handling
- CSRF protection
- Rate limiting
- Captcha support (Turnstile)

## 📝 License

This project is based on [Makerkit](https://makerkit.dev) with vendor agnosticism enhancements.

---

**Ready to build your SaaS with zero vendor lock-in?** Get started in minutes!