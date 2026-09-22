---
spec_id: FILM-101n
status: 🟡 PARTIAL
audited: 2026-09-23
---

# FILM-101 External API Keys Table

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** XS
- **Status:** 🟡 PARTIAL (audit 2026-09-23; was ✅ COMPLETE)
- **Completed:** 2025-12-05
- **PR:** [#3](https://github.com/aroundAI/storybook/pull/3)
- **Dependencies:** None (depends on existing accounts)
- **Blocks:** Phase 4 (video generation), Phase 5 (audio generation)

## Context
The `external_api_keys` table implements Bring Your Own Key (BYOK) functionality, allowing users to use their own API keys for external services (Kling, Runway, ElevenLabs, Suno, Claude, OpenAI). Keys are encrypted and never stored in plaintext.

## Specification

### Table Definition
```sql
CREATE TABLE external_api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID NOT NULL,
  provider VARCHAR(50) NOT NULL,
  encrypted_key TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE NOT NULL,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  CHECK (provider IN ('kling', 'runway', 'hailuo', 'elevenlabs', 'playht', 'suno', 'claude', 'openai', 'gemini')),
  UNIQUE(account_id, provider)
);
```

### Columns
| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| id | UUID | NO | gen_random_uuid() | Primary key |
| account_id | UUID | NO | - | Account owning this key |
| provider | VARCHAR(50) | NO | - | Service provider (see enum) |
| encrypted_key | TEXT | NO | - | Encrypted API key |
| is_active | BOOLEAN | NO | TRUE | Key is active for use |
| last_used_at | TIMESTAMPTZ | YES | NULL | Last time key was used |
| created_at | TIMESTAMPTZ | NO | NOW() | Creation timestamp |

### Provider Enum Values
- `kling` - Kling AI video generation (via PiAPI)
- `runway` - Runway ML video generation
- `hailuo` - Hailuo video generation
- `elevenlabs` - ElevenLabs voice synthesis
- `playht` - Play.ht voice synthesis
- `suno` - Suno music generation
- `claude` - Anthropic Claude (for story/screenplay)
- `openai` - OpenAI GPT (for story/screenplay)
- `gemini` - Google Gemini (for story/screenplay)

### Indexes
```sql
CREATE INDEX idx_external_api_keys_account_id ON external_api_keys(account_id);
CREATE INDEX idx_external_api_keys_provider ON external_api_keys(account_id, provider);
CREATE INDEX idx_external_api_keys_active ON external_api_keys(account_id, is_active)
  WHERE is_active = TRUE;
```

### Constraints
- **Primary Key**: `id`
- **Unique**: `(account_id, provider)` - one key per provider per account
- **Check Constraint**: `provider` in enum values

### Security

**Key Encryption Pattern:**
```typescript
import { encrypt, decrypt } from '@kit/shared/crypto';

async function storeApiKey(accountId: string, provider: string, apiKey: string) {
  // Validate key format (provider-specific)
  validateApiKeyFormat(provider, apiKey);

  // Encrypt before storing
  const encryptedKey = await encrypt(apiKey);

  await client.from('external_api_keys').insert({
    account_id: accountId,
    provider,
    encrypted_key: encryptedKey,
    is_active: true,
  });
}

async function getApiKey(accountId: string, provider: string): Promise<string | null> {
  const { data } = await client
    .from('external_api_keys')
    .select('encrypted_key, is_active')
    .eq('account_id', accountId)
    .eq('provider', provider)
    .eq('is_active', true)
    .single();

  if (!data) return null;

  // Decrypt on retrieval
  const apiKey = await decrypt(data.encrypted_key);

  // Update last_used_at
  await client
    .from('external_api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('account_id', accountId)
    .eq('provider', provider);

  return apiKey;
}
```

**Key Validation:**
```typescript
function validateApiKeyFormat(provider: string, key: string) {
  const patterns: Record<string, RegExp> = {
    openai: /^sk-[A-Za-z0-9]{32,}$/,
    claude: /^sk-ant-api\d{2}-[A-Za-z0-9-_]{95}$/,
    elevenlabs: /^[a-f0-9]{32}$/,
    // ... other providers
  };

  const pattern = patterns[provider];
  if (pattern && !pattern.test(key)) {
    throw new Error(`Invalid API key format for ${provider}`);
  }
}
```

### Billing Integration

When BYOK is used, costs are tracked but not charged to the user's account:

```typescript
// Check if user has BYOK for provider
const byokKey = await getApiKey(accountId, provider);

if (byokKey) {
  // Use user's key - don't deduct credits
  await generateWithUserKey(byokKey, input);

  // Track cost for analytics, but don't charge
  await recordCost(jobId, costCents, { byok: true });
} else {
  // Use platform key - deduct credits
  await checkCredits(accountId, estimatedCost);
  await generateWithPlatformKey(input);
  await deductCredits(accountId, actualCost);
}
```

## File Changes
| Action | Path |
|--------|------|
| CREATE | `apps/web/supabase/schemas/30-film-studio.sql` |

## Acceptance Criteria
- [x] Table created with all columns — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:284`
- [x] Unique constraint on (account_id, provider) — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:293`
- [x] Provider enum constraint enforced — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:292`
- [x] encrypted_key is TEXT (supports variable-length encrypted strings) — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:288`
- [x] Can mark key as inactive without deletion — *audit:* `apps/web/supabase/migrations/20251205125737_film-studio-tables.sql:289`
- [ ] last_used_at tracks usage — *audit: not met* — nothing writes it when a key is used; the only write sets it to null on save (`apps/web/app/home/[account]/settings/_lib/server/api-keys-actions.ts:111`)

## Test Plan

### Unit Tests
- [ ] Insert key with valid provider succeeds — *audit: not met* — no test found
- [ ] Insert key with invalid provider fails — *audit: not met* — no test found
- [ ] Insert duplicate key for same account+provider fails (unique constraint) — *audit: not met* — no test found
- [ ] Insert key for different provider succeeds — *audit: not met* — no test found
- [ ] Timestamps populate automatically — *audit: not met* — no test found

### Integration Tests
- [x] Retrieve active key for account+provider — *audit:* `packages/features/audio-generation/__tests__/config-loader.test.ts:85`
- [x] Inactive keys are excluded from queries — *audit:* `packages/features/audio-generation/__tests__/config-loader.test.ts:85` (asserts the `is_active` filter)
- [ ] Update last_used_at on key retrieval — *audit: not met* — no test found; no code updates it
- [ ] Deactivate key (set is_active = FALSE) — *audit: not met* — no test found
- [ ] Reactivate key (set is_active = TRUE) — *audit: not met* — no test found

### Security Tests
```typescript
// Test encryption round-trip
const originalKey = 'sk-test-1234567890abcdef';
const encrypted = await encrypt(originalKey);
const decrypted = await decrypt(encrypted);

assert(decrypted === originalKey);
assert(encrypted !== originalKey); // Ensure it's actually encrypted

// Test key validation
validateApiKeyFormat('openai', 'sk-1234'); // Should fail
validateApiKeyFormat('openai', 'sk-1234567890abcdefghijklmnopqrstuvwxyz'); // Should pass
```

### Edge Cases
- [ ] Very long API key (2000+ characters) — *audit: not met* — no test found
- [ ] Key rotation (deactivate old, add new) — *audit: not met* — no test found
- [x] Missing key for provider (falls back to platform key) — *audit:* `packages/features/audio-generation/__tests__/config-loader.test.ts:103`
- [ ] Multiple accounts with same provider (different keys) — *audit: not met* — no test found
- [ ] Key never used (last_used_at = NULL) — *audit: not met* — no test found
- [ ] Invalid encrypted_key (decryption fails - handle gracefully) — *audit: not met* — no test found

## Remaining (audit 2026-09-23)

| Criterion | Why it is open | Closed by |
|---|---|---|
| `last_used_at` tracks usage | No key reader updates it; `saveApiKeyAction` writes null (`apps/web/app/home/[account]/settings/_lib/server/api-keys-actions.ts:111`), and `git log -S last_used_at` shows no writer ever existed | unassigned |
