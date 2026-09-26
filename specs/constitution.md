# Storybook Film Studio - Project Constitution

This document defines non-negotiable conventions for the AI Cinematic Film Studio project.
All specs must adhere to these rules.

---

## 1. Technology Stack

| Layer | Technology |
|-------|------------|
| **Framework** | Next.js 15 (App Router) |
| **Database** | Supabase PostgreSQL with RLS |
| **Styling** | Tailwind CSS + Shadcn UI (@kit/ui) |
| **State** | React Query (server) + Zustand (client) |
| **Validation** | Zod schemas |
| **Testing** | Vitest + Playwright |
| **Auth** | @kit/auth (Supabase Auth) |
| **Billing** | @kit/billing (Stripe) |

---

## 2. Code Conventions

### 2.1 File Naming

| Type | Convention | Example |
|------|------------|---------|
| Components | PascalCase.tsx | `ShotGrid.tsx` |
| Server actions | kebab-case.ts | `episode-actions.ts` |
| Utilities | kebab-case.ts | `rate-limiter.ts` |
| Types | Colocated or `types.ts` | `types.ts` |
| Schemas | `schemas.ts` | `lib/schemas.ts` |

### 2.2 Server Actions Pattern

```typescript
'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { z } from 'zod';

const MySchema = z.object({
  // Define input schema
});

export const myAction = enhanceAction(
  async (data, user) => {
    const client = getSupabaseServerClient();

    // Implementation
    const { data: result, error } = await client
      .from('table')
      .select('*')
      .eq('id', data.id)
      .single();

    if (error) throw error;
    return result;
  },
  { schema: MySchema, auth: true }
);
```

### 2.3 Component Pattern

```typescript
'use client';

import { useQuery, useMutation } from '@tanstack/react-query';

interface Props {
  // Always define typed props
}

export function MyComponent({ prop }: Props) {
  // 1. Hooks first
  const { data, isLoading } = useQuery({ ... });

  // 2. Derived state / logic
  const processed = useMemo(() => ..., [data]);

  // 3. Event handlers
  const handleClick = () => { ... };

  // 4. JSX
  return (
    <div>...</div>
  );
}
```

### 2.4 Import Order

```typescript
// 1. React/Next.js
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

// 2. External libraries
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

// 3. Internal packages (@kit/*)
import { Button } from '@kit/ui/button';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// 4. Local imports (relative paths)
import { myAction } from './actions';
import { MySchema } from '../lib/schemas';
```

---

## 3. Database Conventions

### 3.1 Table Naming

| Rule | Example |
|------|---------|
| Plural snake_case | `episodes`, `shots`, `generation_jobs` |
| Junction tables | `{table1}_{table2}` alphabetically |
| Extension tables | `{base_table}_details` |

### 3.2 Column Naming

| Type | Convention | Example |
|------|------------|---------|
| Primary key | `id` | `id UUID PRIMARY KEY` |
| Foreign key | `{table_singular}_id` | `project_id`, `episode_id` |
| Timestamps | Standard names | `created_at`, `updated_at`, `deleted_at` |
| Status columns | `status` | `status VARCHAR(50)` |
| Boolean | `is_*` or `has_*` | `is_active`, `has_audio` |

### 3.3 Required Indexes

- All foreign keys MUST have indexes
- Common query patterns (status, type) MUST have indexes
- Use partial indexes for soft delete: `WHERE deleted_at IS NULL`

```sql
-- Example indexes
CREATE INDEX idx_episodes_project_status ON episodes(project_id, status)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_jobs_status_provider ON generation_jobs(status, provider);
```

### 3.4 JSONB Column Standards

```typescript
// Always define TypeScript interfaces for JSONB columns
interface StoryData {
  premise: string;
  fullStory: string;
  approvedAt?: string;
}

interface ScreenplayData {
  scenes: Scene[];
  generatedAt: string;
  approvedAt?: string;
}
```

---

## 4. Security Requirements

### 4.1 RLS Policies

- Every table MUST have RLS enabled
- Use helper functions for common access patterns
- Never use `SELECT *` in policies

```sql
-- Helper function pattern
CREATE OR REPLACE FUNCTION user_has_project_access(p_project_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM projects p
    JOIN accounts_memberships am ON p.account_id = am.account_id
    WHERE p.id = p_project_id AND am.user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Policy using helper
CREATE POLICY "Project members can access episodes"
ON episodes FOR ALL TO authenticated
USING (user_has_project_access(project_id));
```

### 4.2 API Keys

- NEVER store plaintext API keys
- Use `encrypted_key` column with server-side encryption
- BYOK (Bring Your Own Key) supported for all providers

```typescript
// Encryption pattern
import { encrypt, decrypt } from '@kit/shared/crypto';

async function storeApiKey(accountId: string, provider: string, key: string) {
  const encryptedKey = await encrypt(key);
  await client.from('external_api_keys').insert({
    account_id: accountId,
    provider,
    encrypted_key: encryptedKey,
  });
}
```

### 4.3 Webhook Security

- Always verify signature before processing
- Use constant-time comparison for signatures
- Log verification failures

```typescript
import crypto from 'crypto';

function verifyWebhook(payload: string, signature: string, secret: string): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

### 4.4 Input Validation

- All inputs MUST be validated with Zod schemas
- Server actions MUST use `enhanceAction` with schema
- File uploads MUST validate type, size, and extension

---

## 5. Error Handling

### 5.1 Error Categories

| HTTP Code | Category | User Message |
|-----------|----------|--------------|
| 400 | Validation error | Show specific field errors |
| 401 | Auth required | Redirect to login |
| 402 | Credits exhausted | Show upgrade prompt |
| 403 | Forbidden | "You don't have access" |
| 404 | Not found | "Resource not found" |
| 429 | Rate limited | Show retry-after countdown |
| 500 | Internal error | Generic error + log details |
| 502 | Provider error | "Service temporarily unavailable" |

### 5.2 Generation Job Errors

```typescript
// Error handling for generation jobs
const RETRY_CONFIG = {
  video: { maxRetries: 3, backoff: 'exponential', initialDelay: 30000 },
  voice: { maxRetries: 5, backoff: 'exponential', initialDelay: 5000 },
  music: { maxRetries: 3, backoff: 'exponential', initialDelay: 30000 },
  story: { maxRetries: 2, backoff: 'linear', initialDelay: 1000 },
};
```

**Rules:**
1. Always persist job to DB BEFORE calling provider
2. Use idempotency keys for all generation requests
3. Max 3 retries with exponential backoff (default)
4. Move to dead letter queue after max retries

### 5.3 Error Response Format

```typescript
interface ErrorResponse {
  error: {
    code: string;        // Machine-readable: 'VALIDATION_ERROR', 'RATE_LIMITED'
    message: string;     // Human-readable message
    details?: unknown;   // Optional field-level errors
    retryAfter?: number; // Seconds to wait before retry
  };
}
```

---

## 6. Cost Tracking

### 6.1 Cost Flow

```
1. ESTIMATE cost before job creation
2. CHECK budget before calling provider
3. RESERVE credits (optimistic deduction)
4. CALL provider
5. RECORD actual cost after completion
6. REFUND difference if overcharged
```

### 6.2 Budget Warnings

- Warn at 80% monthly budget consumption
- Block new jobs at 100% (unless override enabled)
- Notify account owner via email at 80%, 90%, 100%

### 6.3 Cost Table (Cents)

| Provider | Operation | Cost |
|----------|-----------|------|
| Kling | video_std | 50 |
| Kling | video_pro | 150 |
| Runway | video_gen3 | 100 |
| Hailuo | video | 40 |
| ElevenLabs | per 1000 chars | 30 |

---

## 7. Testing Requirements

### 7.1 Unit Tests Required For

- All Zod schemas (valid and invalid cases)
- All server actions (success and error paths)
- All provider adapters (mock responses)
- All utility functions
- All cost calculations

### 7.2 Integration Tests Required For

- Database transactions (rollback on error)
- Webhook handlers (signature verification)
- OAuth flows (token refresh)
- RLS policy enforcement

### 7.3 E2E Tests Required For

- Episode creation → Story → Screenplay → Shots → Preview
- ~~Video generation flow with status polling~~ — retired with in-app video generation (`5b88db3a`, 2026-01-15)
- Publishing flow to YouTube

### 7.4 Test File Naming

```
src/
├── components/
│   ├── ShotGrid.tsx
│   └── ShotGrid.test.tsx       # Unit tests colocated
├── server/
│   ├── episode-actions.ts
│   └── episode-actions.test.ts
└── __tests__/
    └── integration/             # Integration tests separate
        └── episode-workflow.test.ts
```

---

## 8. Accessibility (A11y)

### 8.1 Keyboard Navigation

- All interactive elements MUST be keyboard accessible
- Focus order MUST be logical (left-to-right, top-to-bottom)
- Focus MUST be visible (never `outline: none` without replacement)

### 8.2 ARIA Requirements

| Component | Requirements |
|-----------|--------------|
| Icon-only buttons | `aria-label` required |
| Status changes | `aria-live="polite"` |
| Modals | Focus trap, `aria-modal="true"` |
| Loading states | `aria-busy="true"` |
| Progress | `role="progressbar"`, `aria-valuenow` |

### 8.3 Color Contrast

- Minimum AA compliance (4.5:1 for normal text)
- Never use color alone to convey information
- Status indicators need icons + color

---

## 9. Performance Guidelines

### 9.1 Database Queries

- No N+1 queries (use joins or batch queries)
- Use `.select()` to limit columns returned
- Use pagination for lists (max 50 items default)

### 9.2 React Query Caching

```typescript
// Standard cache times
const CACHE_CONFIG = {
  staleTime: 60 * 1000,      // 1 minute
  cacheTime: 5 * 60 * 1000,  // 5 minutes
};

// For frequently changing data (job status)
const REALTIME_CONFIG = {
  staleTime: 5 * 1000,       // 5 seconds
  refetchInterval: 5 * 1000, // Poll every 5s
};
```

### 9.3 Image Optimization

- Use Next.js `Image` component
- Provide width/height to prevent layout shift
- Use appropriate quality (80 for photos, 100 for UI)

---

## 10. Git & PR Conventions

### 10.1 Branch Naming

```
feature/FILM-XXX-short-description
fix/FILM-XXX-bug-description
spike/SPIKE-XX-research-topic
```

### 10.2 Commit Messages

```
feat(FILM-XXX): Add episode CRUD actions

- Create, read, update, delete operations
- Zod schema validation
- RLS policy enforcement

Refs: #123
```

### 10.3 PR Requirements

- [ ] References spec file
- [ ] All acceptance criteria met
- [ ] Tests passing
- [ ] No TypeScript errors
- [ ] No console warnings

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-12 | Initial constitution |

---

**This constitution is the source of truth for all implementation decisions.**
