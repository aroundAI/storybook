---
spec_id: FILM-101j
status: ✅ DONE
audited: 2026-09-23
---

# FILM-101 Platform Connections Table

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** S
- **Status:** ✅ COMPLETE
- **Completed:** 2025-12-05
- **PR:** [#3](https://github.com/aroundAI/storybook/pull/3)
- **Dependencies:** None (depends on existing accounts)
- **Blocks:** FILM-701 (youtube-oauth), FILM-702 (tiktok-oauth), publishing features

## Context
The `platform_connections` table stores OAuth tokens for publishing platforms (YouTube, TikTok, Instagram, Facebook). Tokens are encrypted and include refresh logic for automatic token renewal.

## Specification

### Table Definition
```sql
CREATE TABLE platform_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL,
  platform VARCHAR(50) NOT NULL,
  platform_account_id VARCHAR(255),
  platform_account_name VARCHAR(255),
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  token_expires_at TIMESTAMPTZ,
  scopes TEXT[],
  is_active BOOLEAN DEFAULT TRUE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CHECK (platform IN ('youtube', 'tiktok', 'instagram', 'facebook', 'twitter', 'linkedin')),
  UNIQUE(account_id, platform, platform_account_id)
);
```

### Columns
| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| account_id | UUID | NO | - | Account owning this connection |
| platform | VARCHAR(50) | NO | - | Platform name (see enum) |
| platform_account_id | VARCHAR(255) | YES | NULL | Platform-specific user/channel ID |
| platform_account_name | VARCHAR(255) | YES | NULL | Display name on platform |
| access_token_encrypted | TEXT | YES | NULL | Encrypted OAuth access token |
| refresh_token_encrypted | TEXT | YES | NULL | Encrypted OAuth refresh token |
| token_expires_at | TIMESTAMPTZ | YES | NULL | Access token expiration |
| scopes | TEXT[] | YES | NULL | OAuth scopes granted |
| is_active | BOOLEAN | NO | TRUE | Connection is active |
| created_at | TIMESTAMPTZ | NO | NOW() | Creation timestamp |
| updated_at | TIMESTAMPTZ | NO | NOW() | Last update timestamp |

### Platform Enum Values
- `youtube` - YouTube uploads
- `tiktok` - TikTok uploads
- `instagram` - Instagram Reels
- `facebook` - Facebook videos
- `twitter` - Twitter/X videos
- `linkedin` - LinkedIn posts

### Indexes
```sql
CREATE INDEX idx_platform_connections_account_id ON platform_connections(account_id);
CREATE INDEX idx_platform_connections_platform ON platform_connections(account_id, platform);
CREATE INDEX idx_platform_connections_active ON platform_connections(account_id, is_active)
  WHERE is_active = TRUE;
CREATE INDEX idx_platform_connections_expires_at ON platform_connections(token_expires_at)
  WHERE token_expires_at IS NOT NULL AND is_active = TRUE;
```

### Constraints
- **Primary Key**: `id`
- **Unique**: `(account_id, platform, platform_account_id)`
- **Check Constraint**: `platform` in enum values

### Security

**Token Encryption Pattern:**
```typescript
import { encrypt, decrypt } from '@kit/shared/crypto';

async function storeConnection(data: ConnectionData) {
  const encrypted_access_token = await encrypt(data.access_token);
  const encrypted_refresh_token = await encrypt(data.refresh_token);

  await client.from('platform_connections').insert({
    account_id: data.account_id,
    platform: data.platform,
    access_token_encrypted: encrypted_access_token,
    refresh_token_encrypted: encrypted_refresh_token,
    token_expires_at: data.expires_at,
    scopes: data.scopes,
  });
}

async function getConnection(id: string) {
  const { data } = await client
    .from('platform_connections')
    .select('*')
    .eq('id', id)
    .single();

  const access_token = await decrypt(data.access_token_encrypted);
  const refresh_token = await decrypt(data.refresh_token_encrypted);

  return { ...data, access_token, refresh_token };
}
```

### Token Refresh Strategy
```typescript
interface TokenRefreshConfig {
  refreshBeforeMinutes: number; // Refresh 30 min before expiry
  maxRefreshRetries: number;    // Max 3 retry attempts
}

// Check for expiring tokens
const expiringConnections = await client
  .from('platform_connections')
  .select('*')
  .lte('token_expires_at', new Date(Date.now() + 30 * 60 * 1000))
  .eq('is_active', true);

// Refresh each connection
for (const conn of expiringConnections) {
  await refreshPlatformToken(conn.id, conn.platform);
}
```

### Triggers
```sql
CREATE TRIGGER platform_connections_set_timestamps
BEFORE INSERT OR UPDATE ON platform_connections
FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamps();
```

## File Changes
| Action | Path |
|--------|------|
| CREATE | `apps/web/supabase/schemas/30-film-studio.sql` |

## Acceptance Criteria
- [x] Table created with all columns — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:213`
- [x] Unique constraint on (account_id, platform, platform_account_id) — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:227`; OAuth upserts depend on it (`apps/web/app/api/platforms/callback/youtube/route.ts:265`)
- [x] Platform enum constraint enforced — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:226`
- [x] Indexes for token expiration queries — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:241`
- [x] Timestamps auto-update — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:245`
- [x] Can store multiple connections per account (e.g., 2 YouTube channels) — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:227` (the key includes `platform_account_id`)

## Test Plan

### Unit Tests
- [ ] Insert connection with valid platform succeeds — *audit: not met* — no test asserts it; pgTAP inserts connections only as fixtures (`apps/web/supabase/tests/database/channel-analytics-settings-rls.test.sql:41`)
- [ ] Insert connection with invalid platform fails — *audit: not met* — no test found
- [ ] Insert duplicate connection fails (unique constraint) — *audit: not met* — no test found
- [ ] Insert with NULL tokens allowed (OAuth in progress) — *audit: not met* — not asserted; only a tokenless fixture exercises it (`apps/web/supabase/tests/database/channel-analytics-settings-rls.test.sql:41`)
- [ ] Timestamps populate automatically — *audit: not met* — no test found

### Integration Tests
- [ ] Query expiring tokens (expires_at < NOW + 30 minutes) — *audit: not met* — no test found
- [x] Query active connections only — *audit:* `packages/features/content-analytics/__tests__/subscriber-series-actions.test.ts:152` (the inactive channel is excluded)
- [x] Update tokens after refresh — *audit:* `packages/features/publishing/__tests__/token-refresh.test.ts:355` (Meta; X is never refreshed, KB-15)
- [ ] Deactivate connection (set is_active = FALSE) — *audit: not met* — no test found

### Token Refresh Test
```sql
-- Find connections expiring soon
SELECT id, platform, platform_account_name, token_expires_at
FROM platform_connections
WHERE token_expires_at < NOW() + INTERVAL '30 minutes'
  AND is_active = TRUE;

-- Update after refresh
UPDATE platform_connections
SET
  access_token_encrypted = 'new_encrypted_token',
  token_expires_at = NOW() + INTERVAL '1 hour',
  updated_at = NOW()
WHERE id = 'connection-id';
```

### Edge Cases
- [ ] Connection with no refresh_token (some platforms don't provide) — *audit: not met* — no test found
- [ ] Connection with NULL token_expires_at (non-expiring token) — *audit: not met* — no test found
- [ ] Multiple YouTube channels for same account — *audit: not met* — no test found
- [ ] Reactivating deactivated connection — *audit: not met* — no test found
- [ ] Very long scopes array (100+ scopes) — *audit: not met* — no test found
