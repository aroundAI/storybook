# AroundAIKit - AI SaaS Starter Kit

**Ship production-ready AI applications in days, not months.**

AroundAIKit is the complete Next.js starter kit for building AI-powered SaaS applications. Built-in LLM integration, prompt management, multi-tenancy, and all the infrastructure you need to launch quickly.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## 🚀 Quick Start

Get up and running in 3 steps:

```bash
# 1. Clone and install (30 seconds)
git clone https://github.com/aroundAI/base-saas.git aroundaikit
cd aroundaikit
pnpm install

# 2. Configure environment (2 minutes)
cp apps/web/.env.example apps/web/.env
# Edit .env and add your API keys

# 3. Start development server
pnpm dev
```

Visit **http://localhost:3003** and start building! 🎉

---

## ✨ What's Included Out of the Box

###  🤖 **AI Features**

| Feature | Description | Provider Options |
|---------|-------------|------------------|
| **LLM Integration** | Unified API for multiple AI providers | OpenAI, Anthropic, Gemini, Local |
| **Prompt Management** | Version control, A/B testing, analytics | Built-in database system |
| **Streaming Support** | Real-time AI responses | All providers |
| **Cost Tracking** | Per-user, per-model usage metrics | Automatic tracking |
| **Token Management** | Automatic token counting and limits | All providers |

### 💼 **SaaS Essentials**

| Feature | Status | Description |
|---------|--------|-------------|
| **Multi-Tenancy** | ✅ Ready | Personal & team workspaces with permissions |
| **Authentication** | ✅ Ready | Email, OAuth, magic links, MFA |
| **Billing** | ✅ Ready | Stripe & Lemon Squeezy integration |
| **Projects** | ✅ Ready | Organize AI workflows and resources |
| **Notifications** | ✅ Ready | In-app and email notifications |
| **Admin Panel** | ✅ Ready | User management, analytics, super admin |
| **Audit Logs** | ✅ Ready | Track all important actions |

### 🎨 **Branding & Customization**

| Feature | Configuration | Description |
|---------|--------------|-------------|
| **Environment Branding** | `.env` only | Customize logo, colors, fonts via environment variables |
| **Dark Mode** | Built-in | Automatic theme switching |
| **Custom Fonts** | Google Fonts | 1000+ fonts available |
| **Gradient Effects** | 6 presets | Professional visual effects |

### 🛠️ **Developer Experience**

- ✅ **TypeScript** - Full type safety across the stack
- ✅ **Hot Reload** - Instant feedback during development
- ✅ **Vendor Agnostic** - Switch providers without code changes
- ✅ **Monorepo** - Organized with Turborepo
- ✅ **Testing** - Unit, E2E, and database tests
- ✅ **Monitoring** - Sentry & Baselime integration
- ✅ **Documentation** - Comprehensive guides for every feature

---

## 📦 Core Features Guide

### 1. LLM Integration

Switch between AI providers with zero code changes. One unified API for all providers.

**Usage Example:**

```typescript
import { createLLMClient } from '@kit/llm';

// Automatically uses provider from env vars
const client = createLLMClient();

// Simple chat completion
const response = await client.chat({
  messages: [
    { role: 'user', content: 'Explain quantum computing in simple terms' }
  ]
});

console.log(response.content);
```

**Streaming Example:**

```typescript
const stream = await client.chatStream({
  messages: [{ role: 'user', content: 'Write a poem about AI' }]
});

for await (const chunk of stream) {
  process.stdout.write(chunk.content);
}
```

**Configuration:**

```bash
# OpenAI (Production)
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-...

# Anthropic
LLM_PROVIDER=anthropic
LLM_MODEL=claude-3-5-sonnet-20241022
ANTHROPIC_API_KEY=sk-ant-...

# Gemini (Cost-effective)
LLM_PROVIDER=gemini
LLM_MODEL=gemini-1.5-flash
GOOGLE_API_KEY=AI...

# Local (Development - FREE!)
LLM_PROVIDER=local
LLM_MODEL=claude-sonnet-4-5
LOCAL_API_URL=http://127.0.0.1:8000/v1
```

**Supported Providers & Pricing:**

| Provider | Cost (1M tokens) | Best Models | Best For |
|----------|------------------|-------------|----------|
| Local | **$0** | claude-sonnet-4-5 | Development, testing |
| Gemini Flash 8B | $0.0375 | gemini-1.5-flash-8b | High-volume, cost-sensitive |
| GPT-4o-mini | $0.15 | gpt-4o-mini | Production, balanced |
| Claude 3.5 Sonnet | $3.00 | claude-3-5-sonnet | Complex reasoning |

---

### 2. Prompt Management

Version control your AI prompts with built-in analytics and A/B testing.

**Features:**
- ✅ Template versioning (track changes over time)
- ✅ Variable substitution (`{{user_name}}`, `{{context}}`)
- ✅ A/B testing (compare prompt variants)
- ✅ Performance metrics (track success rates)
- ✅ Cost tracking (monitor spend per prompt)
- ✅ Multi-model support (test across providers)

**Usage:**

Navigate to `/home/[account]/prompts` in your dashboard to:
1. Create new prompt templates
2. Add variables for dynamic content
3. Create variants for A/B testing
4. Track performance metrics
5. Export/import prompts

**Example Prompt Template:**

```
System: You are a helpful {{role}} assistant for {{company_name}}.

User Query: {{user_question}}

Context: {{additional_context}}

Please provide a {{tone}} response.
```

---

### 3. Multi-Tenancy & Teams

Built-in support for personal and team workspaces.

**Features:**
- **Personal Accounts** - Individual user workspaces
- **Team Accounts** - Shared workspaces with members
- **Role-Based Access** - Owner, Admin, Member roles
- **Permissions System** - Granular feature access control
- **Team Billing** - Separate billing per team
- **Member Invitations** - Email invites with role assignment

**How to Use:**

1. **Create Team**: Click "Create Team" in sidebar
2. **Invite Members**: Settings → Members → Invite
3. **Set Permissions**: Assign roles (Owner/Admin/Member)
4. **Team Resources**: All projects, prompts, data scoped to team

**Accessing Team Context:**

```typescript
import { useTeamAccountWorkspace } from '@kit/team-accounts/hooks/use-team-account-workspace';

function MyComponent() {
  const { account, user, accounts } = useTeamAccountWorkspace();

  // account = current team
  // user = current user
  // accounts = all teams user belongs to
}
```

---

### 4. Authentication

Complete authentication system with multiple providers.

**Supported Methods:**
- ✅ Email + Password
- ✅ Magic Links (passwordless)
- ✅ OAuth (Google, GitHub, etc.)
- ✅ Multi-Factor Authentication (MFA)
- ✅ Phone Auth (OTP)

**Configuration:**

```bash
# Enable/disable auth methods
NEXT_PUBLIC_AUTH_PASSWORD=true
NEXT_PUBLIC_AUTH_MAGIC_LINK=false

# OAuth providers (configure in Supabase dashboard)
# Google, GitHub, Facebook, Twitter, etc.
```

**Built-in Pages:**
- `/auth/sign-in` - Sign in
- `/auth/sign-up` - Registration
- `/auth/password-reset` - Password recovery
- `/auth/verify` - Email verification

---

### 5. Billing Integration

Stripe and Lemon Squeezy support out of the box.

**Features:**
- ✅ Subscription management
- ✅ One-time payments
- ✅ Usage-based billing
- ✅ Checkout sessions
- ✅ Customer portal
- ✅ Webhook handling
- ✅ Invoice generation

**Configuration:**

```bash
# Stripe
NEXT_PUBLIC_BILLING_PROVIDER=stripe
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_...
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Or Lemon Squeezy
NEXT_PUBLIC_BILLING_PROVIDER=lemon-squeezy
LEMON_SQUEEZY_API_KEY=...
LEMON_SQUEEZY_STORE_ID=...
```

**Pricing Plans**: Edit `apps/web/config/billing.config.ts`

---

### 6. Projects Feature

Organize AI workflows and resources into projects.

**What You Get:**
- Create unlimited projects
- Associate prompts, data, and resources
- Team collaboration
- Project-level permissions
- Activity tracking
- Archive/restore

**Usage:**
Navigate to `/home/[account]/projects` to manage projects.

**Database Integration:**
All project data is automatically scoped to the correct account (personal or team).

---

### 7. Branding System

Customize your entire application via environment variables - no code changes required!

**Quick Customization:**

```bash
# Logo
NEXT_PUBLIC_LOGO_TEXT="Your AI App"
NEXT_PUBLIC_LOGO_FONT="Space Grotesk"
NEXT_PUBLIC_LOGO_FONT_WEIGHT=700

# Colors
NEXT_PUBLIC_BRAND_PRIMARY="#6366f1"
NEXT_PUBLIC_BRAND_SECONDARY="#06b6d4"
NEXT_PUBLIC_BRAND_ACCENT="#f97316"

# Typography
NEXT_PUBLIC_FONT_HEADING="Quicksand"
NEXT_PUBLIC_FONT_BODY="Inter"

# Metadata
NEXT_PUBLIC_PRODUCT_NAME="Your Product"
NEXT_PUBLIC_SITE_TITLE="Your Tagline"
```

**Advanced Features:**
- Gradient text effects (6 presets)
- Glow/neon effects (4 intensity levels)
- Custom font URLs (beyond Google Fonts)
- Dark mode automatic color adjustment

**See:** `packages/branding/README.md` for complete customization guide

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│         Your Application Code           │
│    (AI Features, Business Logic)        │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│          AI Abstraction Layer           │
│   (@kit/llm, @kit/prompt-templates)     │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│      Infrastructure Abstraction         │
│   (Database, Auth, Storage, Email)      │
└─────────────┬───────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│         Provider Packages               │
│           (@kit/providers-*)            │
│  ┌───────────────────────────────────┐  │
│  │ Database: Supabase, PostgreSQL    │  │
│  │ Auth: Supabase, Cognito, Auth0    │  │
│  │ Storage: Supabase, S3, GCS        │  │
│  │ Email: Resend, SES, SendGrid      │  │
│  │ LLM: OpenAI, Anthropic, Gemini    │  │
│  └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
```

---

## 🛠️ Tech Stack

### **Core Framework**
- **Next.js 15** - App Router, Server Components, Server Actions
- **React 19** - Latest React features
- **TypeScript** - Full type safety
- **Tailwind CSS 4** - Utility-first styling
- **Shadcn UI** - Beautiful, accessible components

### **AI & ML**
- **@kit/llm** - Unified LLM client (OpenAI, Anthropic, Gemini, Local)
- **@kit/prompt-templates** - Prompt versioning and management
- **Streaming** - Server-Sent Events (SSE) for real-time AI

### **Database & Auth**
- **Supabase** - PostgreSQL database with real-time subscriptions
- **Row Level Security** - Database-level authorization
- **Drizzle ORM** - Type-safe database queries (optional)

### **Infrastructure**
- **Vercel** - Serverless deployment (recommended)
- **AWS Lambda** - Alternative deployment via SST
- **Supabase** - Database, Auth, Storage, Realtime
- **Stripe/Lemon Squeezy** - Payment processing

### **Monitoring & Analytics**
- **Sentry** - Error tracking
- **Baselime** - Serverless monitoring
- **Built-in Analytics** - Usage tracking, cost monitoring

---

## 📁 Monorepo Structure

```
aroundaikit/
├── apps/
│   ├── web/                         # Main Next.js application
│   │   ├── app/                     # Next.js App Router
│   │   │   ├── (marketing)/         # Public pages
│   │   │   ├── home/[account]/      # Team dashboards
│   │   │   ├── auth/                # Authentication
│   │   │   └── api/                 # API routes
│   │   ├── config/                  # App configuration
│   │   ├── supabase/                # Database migrations
│   │   └── lib/                     # Utilities
│   └── e2e/                         # Playwright tests
│
├── packages/
│   ├── llm/                         # 🤖 LLM integration
│   ├── branding/                    # 🎨 Branding system
│   ├── cache/                       # ⚡ Caching layer
│   │
│   ├── features/                    # Feature packages
│   │   ├── prompt-templates/        # Prompt management
│   │   ├── projects/                # Projects feature
│   │   ├── team-accounts/           # Multi-tenancy
│   │   ├── auth/                    # Authentication
│   │   ├── accounts/                # User accounts
│   │   ├── admin/                   # Admin panel
│   │   └── notifications/           # Notifications
│   │
│   ├── billing/                     # Stripe & Lemon Squeezy
│   ├── email-templates/             # React Email templates
│   ├── ui/                          # Shadcn UI components
│   ├── supabase/                    # Supabase utilities
│   └── shared/                      # Shared utilities
│
└── tooling/                         # Build configuration
    ├── eslint/
    ├── prettier/
    └── typescript/
```

---

## 🚀 Development Workflow

### **Install Dependencies**

```bash
pnpm install
```

### **Start Development Server**

```bash
pnpm dev
```

This starts:
- Next.js dev server on `http://localhost:3003`
- Supabase local instance on `http://localhost:54321`
- Email testing on `http://localhost:54325`

### **Database Management**

```bash
# Start local Supabase
pnpm supabase:web:start

# Create a migration
pnpm --filter web supabase db diff -f my-feature

# Apply migrations
pnpm --filter web supabase migration up

# Reset database (clean slate)
pnpm supabase:web:reset

# Generate TypeScript types
pnpm supabase:web:typegen
```

### **Code Quality**

```bash
# Type checking
pnpm typecheck

# Linting
pnpm lint:fix

# Formatting
pnpm format:fix

# All checks
pnpm typecheck && pnpm lint:fix && pnpm format:fix
```

### **Testing**

```bash
# Unit tests
pnpm test

# E2E tests
pnpm --filter e2e test

# Database tests
pnpm supabase:web:test
```

---

## 🌍 Deployment

### **Vercel (Recommended)**

1. Push code to GitHub
2. Import project in Vercel
3. Add environment variables
4. Deploy! ✨

**Automatic deployments** on every push to `main`.

### **AWS Lambda (Advanced)**

```bash
# Configure AWS credentials
aws configure

# Deploy infrastructure
pnpm sst deploy --stage production

# Update environment variables in AWS
```

See `DEPLOYMENT.md` for complete deployment guides.

---

## 🔧 Configuration

### **Environment Variables**

Copy `.env.example` to `.env` and configure:

**Required:**
```bash
# Database
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...

# LLM Provider
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-...
```

**Optional:**
```bash
# Billing
NEXT_PUBLIC_BILLING_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_...

# Email
EMAIL_SENDER="Your App <noreply@yourapp.com>"
MAILER_PROVIDER=resend
RESEND_API_KEY=re_...

# Monitoring
SENTRY_DSN=https://...
BASELIME_API_KEY=...
```

See `.env.example` for complete list of options.

---

## 📖 Documentation

### **Feature Guides**
- [LLM Integration](./packages/llm/CLAUDE.md) - Complete guide to using the LLM abstraction
- [Prompt Management](./packages/features/prompt-templates/README.md) - Prompt versioning and testing
- [Branding System](./packages/branding/README.md) - Customization guide
- [Multi-Tenancy](./packages/features/team-accounts/README.md) - Teams and permissions
- [Authentication](./packages/features/auth/README.md) - Auth configuration

### **Infrastructure**
- [Deployment Guide](./DEPLOYMENT.md) - Deploy to Vercel, AWS, or hybrid
- [Database Guide](./apps/web/supabase/CLAUDE.md) - Migrations, RLS, and schema
- [Vendor Lock-in Analysis](./SUPABASE_VENDOR_LOCKIN_REPORT.md) - Provider switching guide

---

## 💰 Cost Optimization

### **Recommended Stack for Different Scales**

| Stage | Users | Monthly Cost | Configuration |
|-------|-------|--------------|---------------|
| **MVP** | <100 | **$0-10** | Local LLM + Supabase free tier |
| **Growth** | <1K | **$35-50** | Gemini Flash + Supabase Pro |
| **Scale** | <10K | **$100-200** | GPT-4o-mini + Supabase |
| **Enterprise** | 10K+ | **Custom** | Claude 3.5 + AWS infrastructure |

### **Cost-Saving Tips**
1. Use **Local LLM** for development (FREE)
2. Start with **Gemini Flash 8B** ($0.0375/1M tokens)
3. Use **Supabase** for database (free tier is generous)
4. Enable **response caching** to reduce LLM calls
5. Set **token limits** to prevent runaway costs

---

## 🔒 Security

- ✅ **Row Level Security (RLS)** - Database-level authorization
- ✅ **CSRF Protection** - Built-in Next.js protection
- ✅ **Rate Limiting** - Prevent abuse
- ✅ **Input Validation** - Zod schemas everywhere
- ✅ **Secure Headers** - CSP, HSTS, X-Frame-Options
- ✅ **API Key Management** - Environment variables only
- ✅ **Audit Logging** - Track all sensitive actions

---

## 🤝 Contributing

Contributions welcome! Please read our contributing guidelines before submitting PRs.

---

## 📝 License

MIT License - see [LICENSE](./LICENSE) for details.

---

## 🆘 Support

- **Documentation**: Check the guides above
- **Issues**: [GitHub Issues](https://github.com/aroundAI/base-saas/issues)
- **Discussions**: [GitHub Discussions](https://github.com/aroundAI/base-saas/discussions)

---

## 🎯 Next Steps

1. ✅ **Run the quick start** (3 steps above)
2. 📖 **Read the LLM guide** (`packages/llm/CLAUDE.md`)
3. 🎨 **Customize branding** (update `.env` colors/fonts)
4. 🤖 **Try prompt management** (navigate to `/home/[account]/prompts`)
5. 🚀 **Build your AI feature** (use the unified LLM client)
6. 🌍 **Deploy to Vercel** (connect GitHub repo)

**Ready to ship your AI product?** Get started now! 🚀

---

**Built with ❤️ for AI developers who want to ship fast.**
