# FILM-510: Voice Cloning ✅ DONE

## Metadata
- **Phase:** 5 - Audio Generation
- **Priority:** P1 (Post-MVP Enhancement)
- **Effort:** L (1-3 days)
- **Dependencies:** FILM-501 (ElevenLabs Provider), FILM-206 (Voice Profile Editor)
- **Blocks:** None
- **Status:** ✅ DONE
- **Implementation Date:** 2025-12-11

---

## Context

Voice cloning allows creators to create custom AI voices from audio samples. This enables consistent character voices across episodes without requiring voice actors for every recording session. ElevenLabs provides voice cloning capabilities that can be integrated into the voice profile system.

---

## Specification

### Requirements

1. **Voice Sample Upload**: Accept audio samples for voice cloning (minimum 1 minute)
2. **Voice Training**: Submit samples to ElevenLabs for voice model creation
3. **Quality Validation**: Validate audio quality before submission
4. **Clone Management**: View, edit, and delete cloned voices
5. **Usage Attribution**: Track and display voice clone usage
6. **Consent Management**: Require voice consent acknowledgment

### Database Schema

```sql
-- Extend voice_profiles table
ALTER TABLE voice_profiles ADD COLUMN IF NOT EXISTS
  clone_status VARCHAR(50); -- pending, training, ready, failed

ALTER TABLE voice_profiles ADD COLUMN IF NOT EXISTS
  clone_samples TEXT[]; -- URLs to uploaded voice samples

ALTER TABLE voice_profiles ADD COLUMN IF NOT EXISTS
  clone_metadata JSONB DEFAULT '{}'; -- { training_started_at, training_completed_at, quality_score }

-- Voice consent tracking
CREATE TABLE voice_consent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voice_profile_id UUID NOT NULL REFERENCES voice_profiles(asset_id) ON DELETE CASCADE,
  consenter_name VARCHAR(255) NOT NULL,
  consenter_email VARCHAR(255),
  consent_type VARCHAR(50) NOT NULL, -- 'self', 'other_authorized'
  consent_text TEXT NOT NULL,
  consent_signature TEXT, -- Digital signature or acknowledgment
  ip_address INET,
  consented_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(voice_profile_id)
);
```

### Voice Cloning Component

```typescript
// packages/features/assets/src/components/voice-cloning-editor.tsx

'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@kit/ui/card';
import { Button } from '@kit/ui/button';
import { Progress } from '@kit/ui/progress';
import { Alert, AlertDescription } from '@kit/ui/alert';
import { Upload, Mic, CheckCircle, AlertCircle } from 'lucide-react';
import { AudioUploader } from './audio-uploader';
import { ConsentDialog } from './consent-dialog';
import { startVoiceCloneAction, checkCloneStatusAction } from '../server/voice-clone-actions';

interface VoiceCloningEditorProps {
  assetId: string;
  projectId: string;
  existingProfile?: VoiceProfile;
}

export function VoiceCloningEditor({
  assetId,
  projectId,
  existingProfile
}: VoiceCloningEditorProps) {
  const [samples, setSamples] = useState<string[]>(existingProfile?.clone_samples || []);
  const [showConsent, setShowConsent] = useState(false);
  const queryClient = useQueryClient();

  const cloneMutation = useMutation({
    mutationFn: startVoiceCloneAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voice-profile', assetId] });
    },
  });

  const totalDuration = calculateTotalDuration(samples);
  const isReady = totalDuration >= 60; // Minimum 1 minute

  return (
    <Card>
      <CardHeader>
        <CardTitle>Voice Cloning</CardTitle>
        <CardDescription>
          Upload voice samples to create a custom AI voice clone.
          Minimum 1 minute of clear audio required.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Sample Upload */}
        <div className="space-y-4">
          <h4 className="font-medium">Voice Samples</h4>
          <AudioUploader
            projectId={projectId}
            assetId={assetId}
            maxSamples={10}
            maxDurationPerSample={300} // 5 minutes max per sample
            acceptedFormats={['.mp3', '.wav', '.m4a']}
            value={samples}
            onChange={setSamples}
          />

          <div className="flex items-center gap-4">
            <Progress value={(totalDuration / 60) * 100} className="flex-1" />
            <span className="text-sm text-muted-foreground">
              {Math.floor(totalDuration)}s / 60s minimum
            </span>
          </div>
        </div>

        {/* Quality Guidelines */}
        <Alert>
          <Mic className="h-4 w-4" />
          <AlertDescription>
            <strong>For best results:</strong>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>Use clear, noise-free audio</li>
              <li>Include varied speech (questions, statements, emotions)</li>
              <li>Avoid background music or multiple speakers</li>
              <li>Record in a consistent environment</li>
            </ul>
          </AlertDescription>
        </Alert>

        {/* Clone Status */}
        {existingProfile?.clone_status && (
          <CloneStatusBadge status={existingProfile.clone_status} />
        )}

        {/* Actions */}
        <div className="flex justify-end gap-4">
          <Button
            onClick={() => setShowConsent(true)}
            disabled={!isReady || cloneMutation.isPending}
          >
            {cloneMutation.isPending ? 'Processing...' : 'Start Voice Clone'}
          </Button>
        </div>

        {/* Consent Dialog */}
        <ConsentDialog
          open={showConsent}
          onOpenChange={setShowConsent}
          onConsent={(consentData) => {
            cloneMutation.mutate({
              assetId,
              samples,
              consent: consentData,
            });
            setShowConsent(false);
          }}
        />
      </CardContent>
    </Card>
  );
}
```

### Server Actions

```typescript
// packages/features/assets/src/server/voice-clone-actions.ts

'use server';

import { enhanceAction } from '@kit/next/actions';
import { getSupabaseServerClient } from '@kit/supabase/server-client';
import { z } from 'zod';

const ConsentSchema = z.object({
  consenterName: z.string().min(1),
  consenterEmail: z.string().email().optional(),
  consentType: z.enum(['self', 'other_authorized']),
  consentText: z.string().min(50),
});

export const startVoiceCloneAction = enhanceAction(
  async ({ assetId, samples, consent }, user) => {
    const client = getSupabaseServerClient();

    // Store consent
    await client.from('voice_consent').upsert({
      voice_profile_id: assetId,
      consenter_name: consent.consenterName,
      consenter_email: consent.consenterEmail,
      consent_type: consent.consentType,
      consent_text: consent.consentText,
    });

    // Update voice profile with samples
    await client
      .from('voice_profiles')
      .update({
        clone_samples: samples,
        clone_status: 'pending',
        clone_metadata: { training_started_at: new Date().toISOString() },
      })
      .eq('asset_id', assetId);

    // Get API key and start cloning
    const { data: asset } = await client
      .from('assets')
      .select('project_id, projects(account_id)')
      .eq('id', assetId)
      .single();

    const apiKey = await getApiKey(asset.projects.account_id, 'elevenlabs');

    // Call ElevenLabs API to create voice clone
    const response = await fetch('https://api.elevenlabs.io/v1/voices/add', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: `Clone_${assetId}`,
        files: samples,
        description: 'Storybook Film Studio voice clone',
      }),
    });

    const data = await response.json();

    if (data.voice_id) {
      // Update with provider voice ID
      await client
        .from('voice_profiles')
        .update({
          provider: 'elevenlabs',
          provider_voice_id: data.voice_id,
          clone_status: 'ready',
          clone_metadata: {
            training_started_at: new Date().toISOString(),
            training_completed_at: new Date().toISOString(),
          },
        })
        .eq('asset_id', assetId);
    }

    return { voiceId: data.voice_id };
  },
  {
    schema: z.object({
      assetId: z.string().uuid(),
      samples: z.array(z.string().url()).min(1),
      consent: ConsentSchema,
    }),
    auth: true,
  }
);

export const deleteVoiceCloneAction = enhanceAction(
  async ({ assetId }, user) => {
    const client = getSupabaseServerClient();

    // Get voice profile
    const { data: profile } = await client
      .from('voice_profiles')
      .select('provider_voice_id, assets(project_id, projects(account_id))')
      .eq('asset_id', assetId)
      .single();

    if (profile?.provider_voice_id) {
      // Delete from ElevenLabs
      const apiKey = await getApiKey(profile.assets.projects.account_id, 'elevenlabs');

      await fetch(`https://api.elevenlabs.io/v1/voices/${profile.provider_voice_id}`, {
        method: 'DELETE',
        headers: { 'xi-api-key': apiKey },
      });
    }

    // Clear clone data
    await client
      .from('voice_profiles')
      .update({
        provider_voice_id: null,
        clone_samples: null,
        clone_status: null,
        clone_metadata: {},
      })
      .eq('asset_id', assetId);

    // Delete consent record
    await client
      .from('voice_consent')
      .delete()
      .eq('voice_profile_id', assetId);

    return { success: true };
  },
  {
    schema: z.object({ assetId: z.string().uuid() }),
    auth: true,
  }
);
```

### File Changes

| Action | Path |
|--------|------|
| CREATE | `packages/features/assets/src/components/voice-cloning-editor.tsx` |
| CREATE | `packages/features/assets/src/components/consent-dialog.tsx` |
| CREATE | `packages/features/assets/src/components/audio-uploader.tsx` |
| CREATE | `packages/features/assets/src/server/voice-clone-actions.ts` |
| MODIFY | `apps/web/supabase/schemas/30-film-studio.sql` |
| MODIFY | `packages/features/assets/src/components/voice-profile-editor.tsx` |

---

## Acceptance Criteria

- [x] Audio samples can be uploaded (MP3, WAV, M4A)
- [x] Minimum 1 minute of audio required before cloning
- [x] Quality guidelines displayed to users
- [x] Consent dialog captures acknowledgment before cloning
- [x] Voice clone created via ElevenLabs API
- [x] Clone status tracked (pending, training, ready, failed)
- [x] Cloned voice usable in dialogue generation
- [x] Voice clone can be deleted with API cleanup

---

## Test Plan

### Unit Tests
- [x] Test audio duration calculation
- [x] Test consent validation schema
- [x] Test file format validation

### Integration Tests
- [x] Test full clone workflow with mock ElevenLabs API
- [x] Test consent storage and retrieval
- [x] Test clone deletion with API cleanup

---

## Error Handling

| Error | User Experience |
|-------|-----------------|
| Insufficient audio | Show progress bar, require more samples |
| Poor audio quality | Display quality feedback, suggest re-recording |
| Clone failed | Show error, allow retry |
| API rate limited | Queue request, notify when complete |

---

## Security Considerations

- Consent required before voice cloning
- Consent records stored for compliance
- Voice samples stored securely with access controls
- Clone can only be used within the project
- Delete removes both local and provider data
