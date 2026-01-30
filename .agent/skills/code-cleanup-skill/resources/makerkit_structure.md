# Makerkit NextJS + Supabase Structure Reference

This document outlines the typical structure of a Makerkit NextJS + Supabase project.

## Directory Structure

```
makerkit-app/
├── app/                          # Next.js 13+ App Router
│   ├── (auth)/                  # Auth-related routes (grouped)
│   │   ├── sign-in/
│   │   ├── sign-up/
│   │   └── layout.tsx
│   ├── (dashboard)/             # Dashboard routes (grouped)
│   │   ├── dashboard/
│   │   ├── settings/
│   │   └── layout.tsx
│   ├── api/                     # API routes
│   │   ├── auth/
│   │   └── webhooks/
│   ├── layout.tsx               # Root layout
│   ├── page.tsx                 # Home page
│   └── globals.css              # Global styles
│
├── components/                   # React components
│   ├── ui/                      # UI primitives (shadcn/ui)
│   │   ├── button.tsx
│   │   ├── dialog.tsx
│   │   └── ...
│   ├── auth/                    # Auth components
│   │   ├── SignInForm.tsx
│   │   └── SignUpForm.tsx
│   ├── dashboard/               # Dashboard components
│   └── shared/                  # Shared components
│
├── lib/                         # Utilities and shared logic
│   ├── hooks/                   # Custom React hooks
│   │   ├── use-user.ts
│   │   └── use-supabase.ts
│   ├── utils/                   # Utility functions
│   │   ├── cn.ts
│   │   └── format.ts
│   ├── types/                   # TypeScript types
│   │   ├── database.ts
│   │   └── ...
│   ├── supabase/                # Supabase clients
│   │   ├── client.ts            # Browser client
│   │   ├── server.ts            # Server client
│   │   └── middleware.ts        # Middleware client
│   └── config/                  # Configuration
│       ├── site.ts
│       └── ...
│
├── supabase/                    # Supabase configuration
│   ├── migrations/              # Database migrations
│   │   ├── 20230101000000_initial_schema.sql
│   │   └── ...
│   ├── functions/               # Edge functions
│   ├── seed.sql                 # Seed data
│   └── config.toml              # Supabase config
│
├── public/                      # Static assets
│   ├── images/
│   └── fonts/
│
├── .env.local                   # Environment variables
├── .env.example                 # Example environment variables
├── next.config.js               # Next.js configuration
├── package.json                 # Dependencies
├── tsconfig.json                # TypeScript configuration
└── tailwind.config.ts           # Tailwind configuration
```

## Key Files and Their Purposes

### Authentication
- `app/(auth)/sign-in/page.tsx` - Sign in page
- `app/(auth)/sign-up/page.tsx` - Sign up page
- `components/auth/SignInForm.tsx` - Sign in form component
- `lib/supabase/server.ts` - Server-side Supabase client

### Dashboard
- `app/(dashboard)/dashboard/page.tsx` - Main dashboard
- `app/(dashboard)/settings/page.tsx` - Settings page
- `components/dashboard/*` - Dashboard-specific components

### Database
- `supabase/migrations/*.sql` - Database schema migrations
- `lib/types/database.ts` - Generated TypeScript types from Supabase

### API
- `app/api/auth/callback/route.ts` - OAuth callback handler
- `app/api/webhooks/*` - Webhook handlers

## Common Patterns

### Server Components (default in App Router)
```tsx
// app/(dashboard)/dashboard/page.tsx
import { createServerClient } from '@/lib/supabase/server'

export default async function DashboardPage() {
  const supabase = createServerClient()
  const { data } = await supabase.from('users').select('*')
  
  return <div>{/* render data */}</div>
}
```

### Client Components
```tsx
'use client'

import { useUser } from '@/lib/hooks/use-user'

export function UserProfile() {
  const user = useUser()
  return <div>{user.email}</div>
}
```

### Route Handlers (API Routes)
```tsx
// app/api/users/route.ts
import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase/server'

export async function GET() {
  const supabase = createServerClient()
  const { data } = await supabase.from('users').select('*')
  
  return NextResponse.json(data)
}
```

### Database Migrations
```sql
-- supabase/migrations/20230101000000_users.sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS policies
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own data"
  ON users FOR SELECT
  USING (auth.uid() = id);
```

## Deprecated Patterns to Watch For

### Old Auth Patterns
- Direct use of `supabase.auth.signIn()` (deprecated in Supabase v2)
- Custom auth flows that don't use Supabase Auth
- Session storage in localStorage

### Old Database Patterns
- Tables without RLS (Row Level Security)
- Unindexed foreign keys
- Missing timestamp columns (created_at, updated_at)

### Old Component Patterns
- Class components (should be function components)
- Pages directory usage (should be app directory)
- getServerSideProps/getStaticProps (should use server components)

## Safe Removal Checklist

When removing code from Makerkit projects:

1. **Check App Router usage**
   - Is this a page.tsx file? (special route)
   - Is this a layout.tsx file? (special route)
   - Is this a route.ts file? (API route)

2. **Check Database dependencies**
   - Does this reference a database table?
   - Are there foreign key constraints?
   - Are there RLS policies referencing this?

3. **Check Auth dependencies**
   - Does this affect authentication flow?
   - Does this modify auth.users table?
   - Does this affect session management?

4. **Check for dynamic imports**
   - Is this loaded via dynamic import()?
   - Is this used in middleware?
   - Is this used in edge functions?

## Environment Variables

Common Makerkit environment variables:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

When removing features, also remove associated environment variables.
