---
spec_id: FILM-101f
status: 🗑️ RETIRED
audited: 2026-09-23
---

# FILM-101 Voice Profiles Table

> **🗑️ Retired (audit 2026-09-23).** `apps/web/supabase/migrations/20260103075610_remove_deprecated_voice_profiles.sql` dropped the table (05ec0ae9, 2026-01-03); the voice link it served had already become a text ElevenLabs voice ID in 30ed2083 (2025-12-25). A character's voice is now `character_details.elevenlabs_voice_id` (`apps/web/supabase/migrations/20251225160000_change_voice_id_to_text.sql:18`). Kept as a record; not outstanding work.

## Metadata
- **Phase:** 1
- **Priority:** P0
- **Effort:** XS
- **Status:** 🗑️ RETIRED (audit 2026-09-23; was ✅ COMPLETE)
- **Completed:** 2025-12-05
- **PR:** [#3](https://github.com/aroundAI/storybook/pull/3)
- **Dependencies:** FILM-101 (assets-table)
- **Blocks:** FILM-501 (elevenlabs-provider), FILM-502 (voice-generation-action)

## Context
The `voice_profiles` table extends the `assets` table for voice-type assets. It stores provider-specific voice configuration (ElevenLabs voice ID, PlayHT voice ID, etc.) and generation settings (stability, similarity, speed).

## Specification

### Table Definition
```sql
CREATE TABLE voice_profiles (
  asset_id UUID PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,
  provider_voice_id VARCHAR(255),
  settings JSONB DEFAULT '{}' NOT NULL,
  CHECK (provider IN ('elevenlabs', 'playht', 'azure', 'google', 'custom')),
  CHECK ((SELECT type FROM assets WHERE id = asset_id) = 'voice')
);
```

### Columns
| Column | Type | Nullable | Default | Description |
|--------|------|----------|---------|-------------|
| asset_id | UUID | NO | - | Primary key, FK to assets table |
| provider | VARCHAR(50) | NO | - | Voice generation provider |
| provider_voice_id | VARCHAR(255) | YES | NULL | Provider's voice ID (if using pre-made voice) |
| settings | JSONB | NO | '{}' | Provider-specific generation settings |

### Provider Enum Values
- `elevenlabs` - ElevenLabs voice generation (primary for MVP)
- `playht` - Play.ht voice generation
- `azure` - Azure Cognitive Services TTS
- `google` - Google Cloud Text-to-Speech
- `custom` - Custom voice model (BYOK)

### Indexes
```sql
-- Index for provider lookups
CREATE INDEX idx_voice_profiles_provider ON voice_profiles(provider);

-- GIN index for settings JSONB queries
CREATE INDEX idx_voice_profiles_settings ON voice_profiles USING GIN (settings);
```

### Constraints
- **Primary Key**: `asset_id` (UUID)
- **Foreign Key**: `asset_id` references `assets(id)` ON DELETE CASCADE
- **Check Constraints**:
  - `provider` must be one of the enum values
  - Asset must be of type 'voice'

### JSONB Schema

#### Settings by Provider

**ElevenLabs Settings:**
```typescript
interface ElevenLabsSettings {
  stability: number;          // 0.0 - 1.0 (higher = more consistent)
  similarityBoost: number;    // 0.0 - 1.0 (higher = closer to original voice)
  style?: number;             // 0.0 - 1.0 (style exaggeration)
  useSpeakerBoost?: boolean;  // Enhance voice clarity
  modelId?: string;           // "eleven_monolingual_v1", "eleven_multilingual_v2"
}
```

**PlayHT Settings:**
```typescript
interface PlayHTSettings {
  speed: number;              // 0.5 - 2.0 (playback speed)
  temperature: number;        // 0.0 - 2.0 (randomness)
  voiceEngine?: string;       // "PlayHT2.0", "Standard"
  emotion?: string;           // "neutral", "happy", "sad", "angry"
  voiceGuidance?: number;     // 1.0 - 6.0 (adherence to voice style)
}
```

**Azure Settings:**
```typescript
interface AzureSettings {
  rate: string;               // "-50%" to "+50%"
  pitch: string;              // "-50Hz" to "+50Hz"
  volume: string;             // "-100%" to "+100%"
  style?: string;             // "cheerful", "sad", "angry", "newscast"
  styleDegree?: number;       // 0.01 - 2.0
}
```

**Google Settings:**
```typescript
interface GoogleSettings {
  speakingRate: number;       // 0.25 - 4.0
  pitch: number;              // -20.0 - 20.0
  volumeGainDb: number;       // -96.0 - 16.0
  effectsProfileId?: string[]; // ["headphone-class-device", "large-home-entertainment-class-device"]
}
```

### Example Data
```sql
-- ElevenLabs voice profile
INSERT INTO assets (project_id, type, name, description)
VALUES ('project-123', 'voice', 'Alice Voice', 'Young female voice, energetic')
RETURNING id;

INSERT INTO voice_profiles (asset_id, provider, provider_voice_id, settings)
VALUES (
  'voice-asset-id',
  'elevenlabs',
  '21m00Tcm4TlvDq8ikWAM',  -- ElevenLabs Rachel voice
  '{
    "stability": 0.5,
    "similarityBoost": 0.75,
    "style": 0.2,
    "useSpeakerBoost": true,
    "modelId": "eleven_multilingual_v2"
  }'
);

-- PlayHT voice profile
INSERT INTO voice_profiles (asset_id, provider, provider_voice_id, settings)
VALUES (
  'voice-asset-id-2',
  'playht',
  'larry',
  '{
    "speed": 1.0,
    "temperature": 1.2,
    "voiceEngine": "PlayHT2.0",
    "emotion": "neutral",
    "voiceGuidance": 3.0
  }'
);
```

## File Changes
| Action | Path |
|--------|------|
| CREATE | `apps/web/supabase/schemas/30-film-studio.sql` |

## Acceptance Criteria
- [ ] Table created successfully with all columns
- [ ] Foreign key to assets with CASCADE delete
- [ ] Check constraint ensures asset is type 'voice'
- [ ] Check constraint ensures valid provider
- [ ] GIN index on settings JSONB
- [ ] Settings JSONB accepts provider-specific configuration
- [ ] Deleting voice asset cascades to delete voice_profiles

## Test Plan

### Unit Tests
- [ ] Insert voice_profiles with valid asset_id (type='voice') succeeds
- [ ] Insert voice_profiles with non-voice asset_id fails (check constraint)
- [ ] Insert voice_profiles with invalid provider fails (check constraint)
- [ ] Insert voice_profiles with NULL provider_voice_id succeeds (custom voice)
- [ ] Insert voice_profiles with valid settings JSONB succeeds
- [ ] Settings default to '{}' if not provided

### Integration Tests
- [ ] Deleting voice asset cascades to delete voice_profiles
- [ ] Character_details can reference voice_profiles via voice_asset_id
- [ ] Can query voices by provider
- [ ] GIN index improves settings JSONB query performance

### Provider-Specific Tests
```sql
-- Test ElevenLabs voice
INSERT INTO voice_profiles (asset_id, provider, provider_voice_id, settings)
VALUES (
  'test-asset-id',
  'elevenlabs',
  '21m00Tcm4TlvDq8ikWAM',
  '{"stability": 0.5, "similarityBoost": 0.75}'
);

-- Test custom voice (no provider_voice_id)
INSERT INTO voice_profiles (asset_id, provider, settings)
VALUES (
  'test-asset-id-2',
  'custom',
  '{"modelPath": "/models/custom_voice.bin"}'
);
```

### JSONB Query Examples
```sql
-- Find all ElevenLabs voices
SELECT a.name, vp.provider_voice_id, vp.settings
FROM assets a
JOIN voice_profiles vp ON a.id = vp.asset_id
WHERE vp.provider = 'elevenlabs';

-- Find voices with high stability
SELECT a.name
FROM assets a
JOIN voice_profiles vp ON a.id = vp.asset_id
WHERE vp.settings @> '{"stability": 0.8}';
```

### Edge Cases
- [ ] Voice profile with minimal settings (empty object)
- [ ] Voice profile with maximal settings (all provider fields)
- [ ] NULL provider_voice_id (custom trained voice)
- [ ] Very long provider_voice_id (255 char limit)
- [ ] Settings with nested objects (complex configuration)
- [ ] Switching provider (update provider and settings)
- [ ] Invalid settings JSON structure (should fail)
