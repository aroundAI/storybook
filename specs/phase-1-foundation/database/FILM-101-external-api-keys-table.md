# FILM-101 External API Keys Table

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** XS
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
- [ ] Table created with all columns
- [ ] Unique constraint on (account_id, provider)
- [ ] Provider enum constraint enforced
- [ ] encrypted_key is TEXT (supports variable-length encrypted strings)
- [ ] Can mark key as inactive without deletion
- [ ] last_used_at tracks usage

## Test Plan

### Unit Tests
- [ ] Insert key with valid provider succeeds
- [ ] Insert key with invalid provider fails
- [ ] Insert duplicate key for same account+provider fails (unique constraint)
- [ ] Insert key for different provider succeeds
- [ ] Timestamps populate automatically

### Integration Tests
- [ ] Retrieve active key for account+provider
- [ ] Inactive keys are excluded from queries
- [ ] Update last_used_at on key retrieval
- [ ] Deactivate key (set is_active = FALSE)
- [ ] Reactivate key (set is_active = TRUE)

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
- [ ] Very long API key (2000+ characters)
- [ ] Key rotation (deactivate old, add new)
- [ ] Missing key for provider (falls back to platform key)
- [ ] Multiple accounts with same provider (different keys)
- [ ] Key never used (last_used_at = NULL)
- [ ] Invalid encrypted_key (decryption fails - handle gracefully)
