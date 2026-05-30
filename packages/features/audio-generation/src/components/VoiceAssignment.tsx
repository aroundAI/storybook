'use client';

import { useEffect, useRef, useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Check,
  ChevronDown,
  Loader2,
  Mic,
  Play,
  Save,
  Sparkles,
  Users,
} from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Checkbox } from '@kit/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { toast } from '@kit/ui/sonner';
import { cn } from '@kit/ui/utils';

import { DEFAULT_VOICE_SETTINGS } from '../lib/constants';
import type { GenerateVoiceFromTextResult } from '../lib/schemas/voice-action.schema';
import type {
  AutoAssignVoicesResponse,
  BulkAssignVoiceResponse,
} from '../lib/schemas/voice-profile.schema';
import type { VoiceSettings as VoiceSettingsType } from '../lib/types';
import { generateVoiceFromTextAction } from '../server/voice-actions';
import {
  autoAssignVoicesAction,
  bulkAssignVoiceAction,
  getVoiceProfileAction,
  listVoicesAction,
  saveVoiceProfileAction,
} from '../server/voice-profile-actions';
import { VoiceSelector } from './VoiceSelector';
import { VoiceSettingsPanel } from './VoiceSettings';

/**
 * Character with voice assignment info
 */
export interface VoiceAssignmentCharacter {
  id: string;
  name: string;
  thumbnailUrl?: string | null;
  voiceAssetId?: string | null;
}

export interface VoiceAssignmentProps {
  characters: VoiceAssignmentCharacter[];
  projectId: string;
  episodeId?: string;
}

export function VoiceAssignmentPanel({
  characters,
  projectId,
  episodeId,
}: VoiceAssignmentProps) {
  // State
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(
    null,
  );
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<Set<string>>(
    new Set(),
  );
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isBulkMode, setIsBulkMode] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [settings, setSettings] = useState<VoiceSettingsType>({
    ...DEFAULT_VOICE_SETTINGS,
  });
  const [previewText, setPreviewText] = useState(
    'Hello, this is a preview of my voice.',
  );
  const [filters, setFilters] = useState({
    language: 'all',
    gender: 'all',
    search: '',
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const queryClient = useQueryClient();

  // Cleanup audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  // Get selected character
  const selectedCharacter = characters.find(
    (c) => c.id === selectedCharacterId,
  );

  // Fetch available voices (with projectId for BYOK support)
  const { data: voicesData, isLoading: voicesLoading } = useQuery({
    queryKey: [
      'voices',
      projectId,
      filters.language !== 'all' ? filters.language : undefined,
      filters.gender !== 'all' ? filters.gender : undefined,
    ],
    queryFn: () =>
      listVoicesAction({
        projectId,
        language: filters.language !== 'all' ? filters.language : undefined,
        gender:
          filters.gender !== 'all'
            ? (filters.gender as 'male' | 'female' | 'neutral')
            : undefined,
      }),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Fetch existing voice profile for selected character
  const { data: existingProfile, isLoading: profileLoading } = useQuery({
    queryKey: ['voice-profile', selectedCharacterId],
    queryFn: () =>
      selectedCharacterId
        ? getVoiceProfileAction({ characterAssetId: selectedCharacterId })
        : null,
    enabled: !!selectedCharacterId,
  });

  // Load existing profile settings when dialog opens
  useEffect(() => {
    if (existingProfile) {
      setSelectedVoiceId(existingProfile.providerVoiceId);
      if (existingProfile.settings) {
        setSettings({
          stability:
            existingProfile.settings.stability ??
            DEFAULT_VOICE_SETTINGS.stability,
          similarityBoost:
            existingProfile.settings.similarityBoost ??
            DEFAULT_VOICE_SETTINGS.similarityBoost,
          style: existingProfile.settings.style ?? DEFAULT_VOICE_SETTINGS.style,
          speed: existingProfile.settings.speed ?? DEFAULT_VOICE_SETTINGS.speed,
          useSpeakerBoost:
            existingProfile.settings.useSpeakerBoost ??
            DEFAULT_VOICE_SETTINGS.useSpeakerBoost,
        });
      }
    } else if (!profileLoading && selectedCharacterId) {
      // Reset to defaults if no existing profile
      setSelectedVoiceId(null);
      setSettings({ ...DEFAULT_VOICE_SETTINGS });
    }
  }, [existingProfile, profileLoading, selectedCharacterId]);

  // Preview mutation
  const previewMutation = useMutation({
    mutationFn: () => {
      if (!selectedVoiceId || !episodeId) {
        throw new Error('Voice and episode required for preview');
      }
      return generateVoiceFromTextAction({
        text: previewText,
        voiceId: selectedVoiceId,
        settings,
        episodeId,
      });
    },
    onSuccess: (result: GenerateVoiceFromTextResult) => {
      // Stop existing audio
      if (audioRef.current) {
        audioRef.current.pause();
      }
      // Play preview
      const audio = new Audio(result.audioUrl);
      audioRef.current = audio;
      audio.play().catch(() => {
        toast.error('Failed to play audio preview');
      });
    },
    onError: (error: Error) => {
      toast.error(`Failed to generate preview: ${error.message}`);
    },
  });

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: () => {
      if (!selectedVoiceId || !selectedCharacterId) {
        throw new Error('Voice and character required');
      }
      return saveVoiceProfileAction({
        characterAssetId: selectedCharacterId,
        providerVoiceId: selectedVoiceId,
        provider: 'elevenlabs',
        settings,
      });
    },
    onSuccess: () => {
      toast.success('Voice profile saved');
      setIsDialogOpen(false);
      queryClient.invalidateQueries({
        queryKey: ['voice-profile', selectedCharacterId],
      });
    },
    onError: (error: Error) => {
      toast.error(`Failed to save: ${error.message}`);
    },
  });

  // Bulk assign mutation
  const bulkAssignMutation = useMutation({
    mutationFn: () => {
      if (!selectedVoiceId || selectedCharacterIds.size === 0) {
        throw new Error('Voice and characters required');
      }
      return bulkAssignVoiceAction({
        characterAssetIds: Array.from(selectedCharacterIds),
        providerVoiceId: selectedVoiceId,
        provider: 'elevenlabs',
        settings,
      });
    },
    onSuccess: (result: BulkAssignVoiceResponse) => {
      toast.success(
        `Assigned voice to ${result.assignedCount} character${result.assignedCount !== 1 ? 's' : ''}`,
      );
      setIsDialogOpen(false);
      setSelectedCharacterIds(new Set());
      setIsBulkMode(false);
      queryClient.invalidateQueries({ queryKey: ['voice-profile'] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to assign: ${error.message}`);
    },
  });

  // Auto-assign mutation
  const autoAssignMutation = useMutation({
    mutationFn: (characterIds: string[]) =>
      autoAssignVoicesAction({
        characterAssetIds: characterIds,
        projectId,
      }),
    onSuccess: (result: AutoAssignVoicesResponse) => {
      toast.success(
        `Auto-assigned voices to ${result.assignedCount} character${result.assignedCount !== 1 ? 's' : ''}`,
      );
      setSelectedCharacterIds(new Set());
      setIsBulkMode(false);
      queryClient.invalidateQueries({ queryKey: ['voice-profile'] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to auto-assign: ${error.message}`);
    },
  });

  // Handlers
  const handleSelectCharacter = (characterId: string) => {
    if (isBulkMode) {
      // Toggle selection
      const newSelection = new Set(selectedCharacterIds);
      if (newSelection.has(characterId)) {
        newSelection.delete(characterId);
      } else {
        newSelection.add(characterId);
      }
      setSelectedCharacterIds(newSelection);
    } else {
      setSelectedCharacterId(characterId);
      setIsDialogOpen(true);
    }
  };

  const handleSelectAll = () => {
    if (selectedCharacterIds.size === characters.length) {
      setSelectedCharacterIds(new Set());
    } else {
      setSelectedCharacterIds(new Set(characters.map((c) => c.id)));
    }
  };

  const handleBulkAssign = () => {
    if (selectedCharacterIds.size === 0) {
      toast.error('Please select characters first');
      return;
    }
    setSelectedCharacterId(null);
    setSelectedVoiceId(null);
    setSettings({ ...DEFAULT_VOICE_SETTINGS });
    setIsDialogOpen(true);
  };

  const handleAutoAssign = () => {
    const targetIds =
      selectedCharacterIds.size > 0
        ? Array.from(selectedCharacterIds)
        : characters.map((c) => c.id);

    autoAssignMutation.mutate(targetIds);
  };

  const handlePreview = () => {
    if (!selectedVoiceId) {
      toast.error('Please select a voice first');
      return;
    }
    if (!episodeId) {
      toast.error('Episode context required for preview');
      return;
    }
    previewMutation.mutate();
  };

  const handleSave = () => {
    if (!selectedVoiceId) {
      toast.error('Please select a voice');
      return;
    }

    if (isBulkMode && selectedCharacterIds.size > 0) {
      bulkAssignMutation.mutate();
    } else {
      saveMutation.mutate();
    }
  };

  const handleResetSettings = () => {
    setSettings({ ...DEFAULT_VOICE_SETTINGS });
  };

  const handleDialogClose = () => {
    setIsDialogOpen(false);
    // Stop any playing audio
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
  };

  const isSaving = saveMutation.isPending || bulkAssignMutation.isPending;
  const isAllSelected =
    selectedCharacterIds.size === characters.length && characters.length > 0;

  return (
    <div className="space-y-4">
      {/* Header with bulk actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mic className="text-muted-foreground h-5 w-5" />
          <span className="font-medium">Voice Assignment</span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant={isBulkMode ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => {
              setIsBulkMode(!isBulkMode);
              if (isBulkMode) {
                setSelectedCharacterIds(new Set());
              }
            }}
            data-test="toggle-bulk-mode"
          >
            <Users className="mr-2 h-4 w-4" />
            {isBulkMode ? 'Exit Bulk Mode' : 'Bulk Mode'}
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                disabled={autoAssignMutation.isPending}
              >
                <Sparkles className="mr-2 h-4 w-4" />
                Auto-Assign
                <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={handleAutoAssign}
                disabled={autoAssignMutation.isPending}
              >
                {selectedCharacterIds.size > 0
                  ? `Auto-assign selected (${selectedCharacterIds.size})`
                  : 'Auto-assign all characters'}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Bulk mode header */}
      {isBulkMode && (
        <div className="bg-muted/50 flex items-center justify-between rounded-lg border p-3">
          <div className="flex items-center gap-3">
            <Checkbox
              checked={isAllSelected}
              onCheckedChange={handleSelectAll}
              aria-label="Select all characters"
              data-test="select-all"
            />
            <span className="text-sm">
              {selectedCharacterIds.size} of {characters.length} selected
            </span>
          </div>
          <Button
            size="sm"
            onClick={handleBulkAssign}
            disabled={selectedCharacterIds.size === 0}
            data-test="bulk-assign-button"
          >
            Assign Voice to Selected
          </Button>
        </div>
      )}

      {/* Character List */}
      <div className="space-y-2" role="list">
        {characters.map((character) => {
          const hasVoice = !!character.voiceAssetId;
          const isSelected = selectedCharacterIds.has(character.id);

          return (
            <div
              key={character.id}
              onClick={() => handleSelectCharacter(character.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  handleSelectCharacter(character.id);
                }
              }}
              tabIndex={0}
              className={cn(
                'flex w-full cursor-pointer items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                'hover:bg-accent focus:ring-ring focus:outline-none focus:ring-2',
                isSelected && 'border-primary bg-primary/5',
              )}
              role="listitem"
              data-test={`character-item-${character.id}`}
            >
              {/* Bulk selection checkbox */}
              {isBulkMode && (
                <Checkbox
                  checked={isSelected}
                  onCheckedChange={() => handleSelectCharacter(character.id)}
                  onClick={(e) => e.stopPropagation()}
                  aria-label={`Select ${character.name}`}
                />
              )}

              {/* Avatar */}
              <div
                className="bg-muted flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-cover bg-center"
                style={
                  character.thumbnailUrl
                    ? { backgroundImage: `url(${character.thumbnailUrl})` }
                    : undefined
                }
                role="img"
                aria-label={character.name}
              >
                {!character.thumbnailUrl && (
                  <span className="text-muted-foreground text-sm font-medium">
                    {character.name.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>

              {/* Name and status */}
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{character.name}</div>
                {hasVoice && (
                  <div className="flex items-center gap-1 text-xs text-green-600">
                    <Check className="h-3 w-3" />
                    Voice assigned
                  </div>
                )}
              </div>

              {/* No voice indicator */}
              {!hasVoice && (
                <div
                  className="h-2 w-2 shrink-0 rounded-full bg-yellow-500"
                  aria-label="No voice assigned"
                />
              )}
            </div>
          );
        })}

        {characters.length === 0 && (
          <div className="text-muted-foreground py-8 text-center text-sm">
            No characters in this project
          </div>
        )}
      </div>

      {/* Voice Assignment Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={handleDialogClose}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {isBulkMode && selectedCharacterIds.size > 0
                ? `Assign Voice to ${selectedCharacterIds.size} Character${selectedCharacterIds.size !== 1 ? 's' : ''}`
                : `Assign Voice: ${selectedCharacter?.name ?? ''}`}
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-6">
            {/* Left: Voice Selection */}
            <div>
              <VoiceSelector
                voices={voicesData?.voices ?? []}
                selectedVoiceId={selectedVoiceId}
                onSelectVoice={setSelectedVoiceId}
                isLoading={voicesLoading}
                filters={filters}
                onFiltersChange={setFilters}
              />
            </div>

            {/* Right: Settings & Preview */}
            <div className="space-y-6">
              {/* Voice Settings */}
              <VoiceSettingsPanel
                settings={settings}
                onSettingsChange={setSettings}
                onReset={handleResetSettings}
                disabled={isSaving}
              />

              {/* Preview Section */}
              {episodeId && (
                <div className="space-y-3">
                  <Label className="text-base font-medium">Test Voice</Label>
                  <Input
                    value={previewText}
                    onChange={(e) => setPreviewText(e.target.value)}
                    placeholder="Enter text to preview..."
                    disabled={isSaving || previewMutation.isPending}
                    data-test="preview-text"
                  />
                  <Button
                    onClick={handlePreview}
                    disabled={
                      !selectedVoiceId ||
                      previewMutation.isPending ||
                      isSaving ||
                      !previewText.trim()
                    }
                    className="w-full"
                    data-test="preview-button"
                  >
                    {previewMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
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
              )}

              {/* Save Actions */}
              <div className="flex gap-2 pt-4">
                <Button
                  onClick={handleSave}
                  disabled={!selectedVoiceId || isSaving}
                  className="flex-1"
                  data-test="save-voice-profile"
                >
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Save Voice Profile
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleDialogClose}
                  disabled={isSaving}
                >
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
