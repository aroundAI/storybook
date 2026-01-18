'use client';

import { useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Music, Speaker, Volume2 } from 'lucide-react';

import {
  ELEVENLABS,
  getElevenLabsAccountInfoAction,
  getElevenLabsModelsAction,
} from '@kit/audio-generation/server';
import {
  type ProjectAudioSettings,
  updateProjectAudioSettingsAction,
} from '@kit/projects/mutations';
import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Label } from '@kit/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { Separator } from '@kit/ui/separator';
import { toast } from '@kit/ui/sonner';

interface AudioSettingsFormProps {
  projectId: string;
  accountId: string;
  currentSettings: ProjectAudioSettings | null;
}

export function AudioSettingsForm({
  projectId,
  accountId,
  currentSettings,
}: AudioSettingsFormProps) {
  const queryClient = useQueryClient();

  // Local state for form - no defaults, must be configured
  const [ttsModel, setTtsModel] = useState(
    currentSettings?.elevenlabs?.tts_model || '',
  );
  const [sfxModel, setSfxModel] = useState(
    currentSettings?.elevenlabs?.sfx_model || '',
  );
  const [musicModel, setMusicModel] = useState(
    currentSettings?.elevenlabs?.music_model || '',
  );
  const [voiceProvider, setVoiceProvider] = useState<
    'elevenlabs' | 'playht' | 'azure' | 'google'
  >(currentSettings?.voice_provider || 'elevenlabs');

  // Check ElevenLabs connection status
  const { data: elevenLabsInfo, isLoading: isLoadingConnection } = useQuery({
    queryKey: ['elevenlabs-connection', accountId],
    queryFn: () => getElevenLabsAccountInfoAction({ accountId }),
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Fetch available models from ElevenLabs API
  const { data: modelsData, isLoading: isLoadingModels } = useQuery({
    queryKey: ['elevenlabs-models', accountId],
    queryFn: () => getElevenLabsModelsAction({ accountId }),
    staleTime: 1000 * 60 * 30, // 30 minutes - models don't change often
    enabled: !!elevenLabsInfo?.isConnected,
  });

  const availableModels = modelsData?.models || [];

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async () => {
      return updateProjectAudioSettingsAction({
        projectId,
        audioSettings: {
          elevenlabs: {
            enabled: true,
            tts_model: ttsModel,
            sfx_model: sfxModel,
            music_model: musicModel,
          },
          voice_provider: voiceProvider,
        },
      });
    },
    onSuccess: () => {
      toast.success('Audio settings saved');
      queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to save settings',
      );
    },
  });

  const isConnected = elevenLabsInfo?.isConnected;

  // Find current model description
  const currentModelInfo = availableModels.find((m) => m.model_id === ttsModel);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Volume2 className="h-5 w-5" />
          Audio Generation Settings
        </CardTitle>
        <CardDescription>
          Configure voice, sound effects, and music generation for this project.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* ElevenLabs Connection Status */}
        {isLoadingConnection ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" />
            Checking ElevenLabs connection...
          </div>
        ) : isConnected ? (
          <Alert>
            <Check className="h-4 w-4" />
            <AlertTitle className="flex items-center gap-2">
              ElevenLabs Connected
              {elevenLabsInfo?.subscription?.tier && (
                <Badge variant="secondary" className="capitalize">
                  {elevenLabsInfo.subscription.tier}
                </Badge>
              )}
            </AlertTitle>
            <AlertDescription>
              {elevenLabsInfo?.characterCount !== undefined &&
                elevenLabsInfo?.characterLimit !== undefined && (
                  <span>
                    {elevenLabsInfo.characterCount.toLocaleString()} /{' '}
                    {elevenLabsInfo.characterLimit.toLocaleString()} characters
                    used
                  </span>
                )}
            </AlertDescription>
          </Alert>
        ) : (
          <Alert variant="destructive">
            <AlertTitle>ElevenLabs Not Connected</AlertTitle>
            <AlertDescription>
              Add your ElevenLabs API key in Settings → API Keys to enable voice
              generation.
            </AlertDescription>
          </Alert>
        )}

        <Separator />

        {/* Voice (TTS) Settings */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Speaker className="text-muted-foreground h-4 w-4" />
            <Label className="font-medium">Voice (Text-to-Speech)</Label>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="voice-provider">Provider</Label>
              <Select
                value={voiceProvider}
                onValueChange={(value) =>
                  setVoiceProvider(
                    value as 'elevenlabs' | 'playht' | 'azure' | 'google',
                  )
                }
                disabled={!isConnected}
              >
                <SelectTrigger id="voice-provider">
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
                  <SelectItem value="playht" disabled>
                    PlayHT (Coming Soon)
                  </SelectItem>
                  <SelectItem value="azure" disabled>
                    Azure TTS (Coming Soon)
                  </SelectItem>
                  <SelectItem value="google" disabled>
                    Google Cloud TTS (Coming Soon)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tts-model">TTS Model</Label>
              <Select
                value={ttsModel}
                onValueChange={setTtsModel}
                disabled={
                  !isConnected ||
                  voiceProvider !== 'elevenlabs' ||
                  isLoadingModels
                }
              >
                <SelectTrigger id="tts-model">
                  {isLoadingModels ? (
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Loading models...
                    </div>
                  ) : (
                    <SelectValue placeholder="Select model" />
                  )}
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((model) => (
                    <SelectItem key={model.model_id} value={model.model_id}>
                      <div className="flex items-center gap-2">
                        <span>{model.name}</span>
                        {model.languages && model.languages.length > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {model.languages.length} languages
                          </Badge>
                        )}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {currentModelInfo?.description && (
                <p className="text-muted-foreground text-xs">
                  {currentModelInfo.description}
                </p>
              )}
            </div>
          </div>
        </div>

        <Separator />

        {/* SFX Settings */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Volume2 className="text-muted-foreground h-4 w-4" />
            <Label className="font-medium">Sound Effects</Label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sfx-model">SFX Model</Label>
            <Select
              value={sfxModel}
              onValueChange={setSfxModel}
              disabled={!isConnected}
            >
              <SelectTrigger id="sfx-model" className="w-full sm:w-1/2">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {ELEVENLABS.SFX_MODELS.map(
                  (model: {
                    model_id: string;
                    name: string;
                    description: string;
                  }) => (
                    <SelectItem key={model.model_id} value={model.model_id}>
                      <div className="flex flex-col">
                        <span>{model.name}</span>
                        <span className="text-muted-foreground text-xs">
                          {model.description}
                        </span>
                      </div>
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Separator />

        {/* Music Settings */}
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Music className="text-muted-foreground h-4 w-4" />
            <Label className="font-medium">Music Generation</Label>
          </div>

          <div className="space-y-2">
            <Label htmlFor="music-model">Music Model</Label>
            <Select
              value={musicModel}
              onValueChange={setMusicModel}
              disabled={!isConnected}
            >
              <SelectTrigger id="music-model" className="w-full sm:w-1/2">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {ELEVENLABS.MUSIC_MODELS.map(
                  (model: {
                    model_id: string;
                    name: string;
                    description: string;
                  }) => (
                    <SelectItem key={model.model_id} value={model.model_id}>
                      <div className="flex flex-col">
                        <span>{model.name}</span>
                        <span className="text-muted-foreground text-xs">
                          {model.description}
                        </span>
                      </div>
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end pt-4">
          <Button
            onClick={() => updateMutation.mutate()}
            disabled={!isConnected || updateMutation.isPending}
          >
            {updateMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              'Save Audio Settings'
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
