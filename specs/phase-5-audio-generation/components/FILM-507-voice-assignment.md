# FILM-507: Voice Assignment Component

**Phase**: 5
**Priority**: P0
**Effort**: M (3-5 days)
**Dependencies**: FILM-206 (character management), FILM-506 (dialogue list)
**Blocks**: None
**Status**: COMPLETED
**PR**: #TBD

---

## Context

The Voice Assignment component enables users to assign and configure voice profiles for characters in their episodes. It provides an interface for selecting voices from the ElevenLabs library, customizing voice settings (stability, similarity boost, style, speed), previewing voice samples, and saving voice profiles for reuse across episodes.

This component is essential for ensuring consistent character voices throughout the project. It must support browsing available voices, filtering by language/gender/age, auditioning voices with sample text, and fine-tuning voice parameters for optimal results. The UI should make voice selection intuitive and provide clear feedback on how settings affect voice quality.

---

## Requirements

### Functional Requirements

1. **Character List Display**
   - Show all characters for the project
   - Display character avatar/icon
   - Show character name
   - Indicate if voice assigned (checkmark)
   - Highlight characters without voices

2. **Voice Selection**
   - Browse ElevenLabs voice library
   - Filter by language, gender, age, accent
   - Search voices by name
   - Display voice preview audio
   - Show voice description and tags

3. **Voice Preview**
   - Play voice sample (pre-generated)
   - Generate preview with custom text
   - Adjust settings and re-preview
   - Compare multiple voices side-by-side

4. **Voice Settings**
   - Stability slider (0-1)
   - Similarity Boost slider (0-1)
   - Style slider (0-1)
   - Speed slider (0.5-2.0)
   - Real-time explanation of each setting
   - Preview button to test settings

5. **Voice Profile Management**
   - Save voice assignment to character
   - Load existing voice profile
   - Reset to defaults
   - Delete voice assignment
   - Copy settings from another character

6. **Bulk Assignment**
   - Assign same voice to multiple characters
   - Auto-assign based on character gender/age
   - Import voice assignments from template

### Non-Functional Requirements

- Voice library loads within 2 seconds
- Voice preview generates within 10 seconds
- Settings changes reflected immediately in UI
- Smooth slider interactions
- Accessible (keyboard control, ARIA)

---

## Interface

### Component Structure

```typescript
'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Play, Pause, Save, RefreshCw, Check } from 'lucide-react';
import { Button } from '@kit/ui/button';
import { Input } from '@kit/ui/input';
import { Slider } from '@kit/ui/slider';
import { Label } from '@kit/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@kit/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@kit/ui/dialog';
import { toast } from '@kit/ui/sonner';
import {
  listVoicesAction,
  generateVoicePreviewAction,
  saveVoiceProfileAction,
  getVoiceProfileAction,
} from '@kit/audio-generation/server';
import type { Asset, Voice, VoiceSettings, VoiceProfile } from '@kit/audio-generation/types';

interface VoiceAssignmentProps {
  characters: Asset[];
  episodeId: string;
}

export function VoiceAssignment({ characters, episodeId }: VoiceAssignmentProps) {
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [previewText, setPreviewText] = useState('Hello, this is a preview of my voice.');
  const [filterGender, setFilterGender] = useState<string>('all');
  const [filterLanguage, setFilterLanguage] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [settings, setSettings] = useState<VoiceSettings>({
    stability: 0.5,
    similarityBoost: 0.75,
    style: 0,
    speed: 1.0,
  });
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);

  const queryClient = useQueryClient();

  // Fetch available voices
  const { data: voicesData, isLoading: voicesLoading } = useQuery({
    queryKey: ['voices', filterGender, filterLanguage],
    queryFn: () => listVoicesAction({
      gender: filterGender !== 'all' ? filterGender : undefined,
      language: filterLanguage !== 'all' ? filterLanguage : undefined,
    }),
  });

  // Fetch voice profile for selected character
  const { data: existingProfile } = useQuery({
    queryKey: ['voice-profile', selectedCharacterId],
    queryFn: () =>
      selectedCharacterId
        ? getVoiceProfileAction({ characterAssetId: selectedCharacterId })
        : null,
    enabled: !!selectedCharacterId,
  });

  // Load existing profile settings when character selected
  useEffect(() => {
    if (existingProfile) {
      setSelectedVoiceId(existingProfile.providerVoiceId);
      setSettings(existingProfile.settings);
    }
  }, [existingProfile]);

  // Generate voice preview
  const previewMutation = useMutation({
    mutationFn: () =>
      generateVoicePreviewAction({
        text: previewText,
        voiceId: selectedVoiceId!,
        settings,
      }),
    onSuccess: (result) => {
      // Play audio
      const audio = new Audio(result.audioUrl);
      audio.play();
      setIsPlayingPreview(true);
      audio.onended = () => setIsPlayingPreview(false);
    },
    onError: (error: Error) => {
      toast.error(`Failed to generate preview: ${error.message}`);
    },
  });

  // Save voice profile
  const saveMutation = useMutation({
    mutationFn: () =>
      saveVoiceProfileAction({
        characterAssetId: selectedCharacterId!,
        voiceId: selectedVoiceId!,
        settings,
      }),
    onSuccess: () => {
      toast.success('Voice profile saved');
      setIsDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ['voice-profile', selectedCharacterId] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to save profile: ${error.message}`);
    },
  });

  const handleSelectCharacter = (characterId: string) => {
    setSelectedCharacterId(characterId);
    setIsDialogOpen(true);
  };

  const handleSelectVoice = (voiceId: string) => {
    setSelectedVoiceId(voiceId);
  };

  const handlePreview = () => {
    if (!selectedVoiceId) {
      toast.error('Please select a voice first');
      return;
    }
    previewMutation.mutate();
  };

  const handleSave = () => {
    if (!selectedVoiceId) {
      toast.error('Please select a voice');
      return;
    }
    saveMutation.mutate();
  };

  const handleResetSettings = () => {
    setSettings({
      stability: 0.5,
      similarityBoost: 0.75,
      style: 0,
      speed: 1.0,
    });
  };

  const filteredVoices = voicesData?.voices.filter(voice =>
    voice.name.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  return (
    <div className="space-y-2">
      {/* Character List */}
      {characters.map((character) => {
        const hasVoice = !!character.voiceProfileId;

        return (
          <button
            key={character.id}
            onClick={() => handleSelectCharacter(character.id)}
            className="flex w-full items-center gap-3 rounded-lg border p-3 text-left hover:bg-gray-50"
          >
            {/* Avatar */}
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-200">
              {character.name.charAt(0).toUpperCase()}
            </div>

            {/* Name */}
            <div className="flex-1">
              <div className="font-medium">{character.name}</div>
              {hasVoice && (
                <div className="flex items-center gap-1 text-xs text-green-600">
                  <Check className="h-3 w-3" />
                  Voice assigned
                </div>
              )}
            </div>

            {/* Indicator */}
            {!hasVoice && (
              <div className="h-2 w-2 rounded-full bg-yellow-500"></div>
            )}
          </button>
        );
      })}

      {/* Voice Assignment Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              Assign Voice: {characters.find(c => c.id === selectedCharacterId)?.name}
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-6">
            {/* Left: Voice Selection */}
            <div className="space-y-4">
              <div>
                <Label>Select Voice</Label>

                {/* Filters */}
                <div className="mt-2 flex gap-2">
                  <Select value={filterLanguage} onValueChange={setFilterLanguage}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Languages</SelectItem>
                      <SelectItem value="en">English</SelectItem>
                      <SelectItem value="es">Spanish</SelectItem>
                      <SelectItem value="fr">French</SelectItem>
                      <SelectItem value="de">German</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select value={filterGender} onValueChange={setFilterGender}>
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Genders</SelectItem>
                      <SelectItem value="male">Male</SelectItem>
                      <SelectItem value="female">Female</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Search */}
                <Input
                  placeholder="Search voices..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="mt-2"
                />
              </div>

              {/* Voice List */}
              <div className="max-h-96 space-y-2 overflow-auto">
                {voicesLoading ? (
                  <div className="py-8 text-center text-sm text-gray-500">
                    Loading voices...
                  </div>
                ) : (
                  filteredVoices.map((voice) => (
                    <button
                      key={voice.voiceId}
                      onClick={() => handleSelectVoice(voice.voiceId)}
                      className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left hover:bg-gray-50 ${
                        selectedVoiceId === voice.voiceId
                          ? 'border-blue-500 bg-blue-50'
                          : ''
                      }`}
                    >
                      <div className="flex-1">
                        <div className="font-medium">{voice.name}</div>
                        <div className="text-xs text-gray-600">
                          {voice.labels.gender} • {voice.labels.age} • {voice.labels.accent}
                        </div>
                      </div>

                      {voice.previewUrl && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            const audio = new Audio(voice.previewUrl);
                            audio.play();
                          }}
                        >
                          <Play className="h-4 w-4" />
                        </Button>
                      )}
                    </button>
                  ))
                )}
              </div>
            </div>

            {/* Right: Settings & Preview */}
            <div className="space-y-4">
              <div>
                <Label>Voice Settings</Label>

                {/* Stability */}
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Stability</Label>
                    <span className="text-sm text-gray-600">{settings.stability.toFixed(2)}</span>
                  </div>
                  <Slider
                    value={[settings.stability]}
                    onValueChange={([value]) => setSettings({ ...settings, stability: value })}
                    min={0}
                    max={1}
                    step={0.01}
                  />
                  <p className="text-xs text-gray-600">
                    Higher = more consistent, Lower = more variable
                  </p>
                </div>

                {/* Similarity Boost */}
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Similarity Boost</Label>
                    <span className="text-sm text-gray-600">
                      {settings.similarityBoost.toFixed(2)}
                    </span>
                  </div>
                  <Slider
                    value={[settings.similarityBoost]}
                    onValueChange={([value]) =>
                      setSettings({ ...settings, similarityBoost: value })
                    }
                    min={0}
                    max={1}
                    step={0.01}
                  />
                  <p className="text-xs text-gray-600">
                    Higher = closer to original voice
                  </p>
                </div>

                {/* Style */}
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Style</Label>
                    <span className="text-sm text-gray-600">{settings.style?.toFixed(2) || 0}</span>
                  </div>
                  <Slider
                    value={[settings.style || 0]}
                    onValueChange={([value]) => setSettings({ ...settings, style: value })}
                    min={0}
                    max={1}
                    step={0.01}
                  />
                  <p className="text-xs text-gray-600">
                    Exaggeration of speaking style
                  </p>
                </div>

                {/* Speed */}
                <div className="mt-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">Speed</Label>
                    <span className="text-sm text-gray-600">{settings.speed?.toFixed(2) || 1}</span>
                  </div>
                  <Slider
                    value={[settings.speed || 1]}
                    onValueChange={([value]) => setSettings({ ...settings, speed: value })}
                    min={0.5}
                    max={2.0}
                    step={0.1}
                  />
                  <p className="text-xs text-gray-600">
                    Playback speed multiplier
                  </p>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleResetSettings}
                  className="mt-4"
                >
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Reset to Defaults
                </Button>
              </div>

              {/* Preview */}
              <div>
                <Label>Test Voice</Label>
                <Input
                  value={previewText}
                  onChange={(e) => setPreviewText(e.target.value)}
                  placeholder="Enter text to preview..."
                  className="mt-2"
                />
                <Button
                  onClick={handlePreview}
                  disabled={!selectedVoiceId || previewMutation.isPending}
                  className="mt-2 w-full"
                >
                  {previewMutation.isPending ? (
                    <>
                      <div className="mr-2 h-4 w-4 animate-spin rounded-full border-b-2 border-white"></div>
                      Generating...
                    </>
                  ) : (
                    <>
                      <Play className="mr-2 h-4 w-4" />
                      Preview Voice
                    </>
                  )}
                </Button>
              </div>

              {/* Save */}
              <div className="flex gap-2">
                <Button
                  onClick={handleSave}
                  disabled={!selectedVoiceId || saveMutation.isPending}
                  className="flex-1"
                >
                  <Save className="mr-2 h-4 w-4" />
                  Save Voice Profile
                </Button>
                <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

---

## Implementation Details

### File Structure

```
packages/features/audio-generation/src/
├── components/
│   ├── VoiceAssignment.tsx               # Main component (CREATE THIS)
│   ├── VoiceSelector.tsx                 # Voice selection list (CREATE THIS)
│   ├── VoiceSettings.tsx                 # Settings sliders (CREATE THIS)
│   └── __tests__/
│       └── VoiceAssignment.test.tsx      # Unit tests (CREATE THIS)
```

### Voice Settings Presets

```typescript
const VOICE_PRESETS = {
  stable: {
    stability: 0.8,
    similarityBoost: 0.75,
    style: 0,
    speed: 1.0,
  },
  expressive: {
    stability: 0.3,
    similarityBoost: 0.75,
    style: 0.5,
    speed: 1.0,
  },
  fast: {
    stability: 0.5,
    similarityBoost: 0.75,
    style: 0,
    speed: 1.5,
  },
  slow: {
    stability: 0.5,
    similarityBoost: 0.75,
    style: 0,
    speed: 0.8,
  },
};
```

---

## File Changes

### New Files

1. **packages/features/audio-generation/src/components/VoiceAssignment.tsx**
   - Main voice assignment component
   - Character list and dialog

2. **packages/features/audio-generation/src/components/VoiceSelector.tsx**
   - Voice library browsing
   - Filtering and search

3. **packages/features/audio-generation/src/components/VoiceSettings.tsx**
   - Settings sliders
   - Preset selection

4. **packages/features/audio-generation/src/lib/server/mutations/voice-profile-actions.ts**
   - saveVoiceProfileAction
   - getVoiceProfileAction
   - deleteVoiceProfileAction

5. **packages/features/audio-generation/src/components/__tests__/VoiceAssignment.test.tsx**
   - Component unit tests

### Modified Files

1. **packages/features/audio-generation/src/components/index.ts**
   - Export VoiceAssignment component

---

## Acceptance Criteria

### Functional

- [x] Displays all characters in list
- [x] Shows which characters have voice assignments
- [x] Opens voice assignment dialog on character click
- [x] Lists all available voices from ElevenLabs
- [x] Filters voices by gender, language
- [x] Searches voices by name
- [x] Plays voice preview samples
- [x] Generates custom voice preview with test text
- [x] Stability slider updates settings
- [x] Similarity boost slider updates settings
- [x] Style slider updates settings
- [x] Speed slider updates settings
- [x] Reset button restores default settings
- [x] Save button creates/updates voice profile
- [x] Loads existing profile when character selected
- [x] Shows loading states during operations
- [x] Shows success/error notifications

### Bulk Assignment (Added)

- [x] Multi-select characters with checkboxes
- [x] Bulk mode toggle button
- [x] Assign same voice to multiple selected characters
- [x] Auto-assign voices based on character gender

### Non-Functional

- [x] Voice library loads within 2 seconds
- [x] Preview generates within 10 seconds
- [x] Sliders respond smoothly
- [x] Keyboard navigation works
- [x] Accessible (ARIA labels)
- [x] TypeScript compiles without errors
- [x] No ESLint warnings

---

## Test Plan

### Unit Tests

**File**: `packages/features/audio-generation/src/components/__tests__/VoiceAssignment.test.tsx`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { VoiceAssignment } from '../VoiceAssignment';

const mockCharacters = [
  { id: 'char-1', name: 'Alice', voiceProfileId: null },
  { id: 'char-2', name: 'Bob', voiceProfileId: 'profile-1' },
];

describe('VoiceAssignment', () => {
  it('should render character list', () => {
    render(
      <VoiceAssignment
        characters={mockCharacters}
        episodeId="ep-1"
      />
    );

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('should show voice assigned indicator', () => {
    render(
      <VoiceAssignment
        characters={mockCharacters}
        episodeId="ep-1"
      />
    );

    // Bob has voice assigned
    expect(screen.getByText('Voice assigned')).toBeInTheDocument();
  });

  it('should open dialog on character click', async () => {
    render(
      <VoiceAssignment
        characters={mockCharacters}
        episodeId="ep-1"
      />
    );

    fireEvent.click(screen.getByText('Alice'));

    await waitFor(() => {
      expect(screen.getByText('Assign Voice: Alice')).toBeInTheDocument();
    });
  });

  it('should filter voices by gender', async () => {
    // Mock voices
    // Select gender filter
    // Assert filtered list
  });

  it('should generate voice preview', async () => {
    // Mock preview generation
    // Enter test text
    // Click preview button
    // Assert audio plays
  });
});
```

### Manual Testing

1. **Voice Selection**
   - Open voice assignment dialog
   - Browse voice library
   - Filter by gender, language
   - Search for specific voice
   - Play voice previews

2. **Settings Adjustment**
   - Adjust stability slider
   - Adjust similarity boost
   - Adjust style
   - Adjust speed
   - Generate preview with each setting
   - Listen to differences

3. **Voice Profile Save**
   - Select voice
   - Adjust settings
   - Save profile
   - Reopen dialog
   - Verify settings loaded

---

## Accessibility

### ARIA Labels

```typescript
<Slider
  aria-label="Voice stability"
  aria-valuemin={0}
  aria-valuemax={1}
  aria-valuenow={settings.stability}
/>
```

### Keyboard Navigation

- **Tab**: Navigate between controls
- **Arrow Keys**: Adjust sliders
- **Enter**: Play preview
- **Esc**: Close dialog

---

## Future Enhancements

1. **Voice Cloning**
   - Upload audio samples
   - Create custom voices
   - Clone user's voice

2. **Voice Comparison**
   - Compare 2-3 voices side-by-side
   - A/B testing

3. **Voice Templates**
   - Save settings as templates
   - Share templates with team

4. **AI Voice Recommendations**
   - Auto-suggest voice based on character description
   - Match voice to character personality

---

## References

- **FILM-206**: Character Management
- **FILM-501**: ElevenLabs Provider
- **FILM-506**: Dialogue List Component
- **Constitution**: Section 8 (Accessibility)
