'use client';

import { useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Loader2, Music, Speaker, Volume2 } from 'lucide-react';

import {
    ELEVENLABS_MODELS,
    getElevenLabsAccountInfoAction,
} from '@kit/audio-generation/server';
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

import { updateProjectAudioSettingsAction, type ProjectAudioSettings } from '@kit/projects/mutations';

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

    // Local state for form
    const [ttsModel, setTtsModel] = useState(
        currentSettings?.elevenlabs?.tts_model || 'eleven_multilingual_v2',
    );
    const [sfxModel, setSfxModel] = useState(
        currentSettings?.elevenlabs?.sfx_model || 'eleven_multilingual_v2',
    );
    const [voiceProvider, setVoiceProvider] = useState<'elevenlabs' | 'playht' | 'azure' | 'google'>(
        currentSettings?.voice_provider || 'elevenlabs',
    );

    // Check ElevenLabs connection status
    const { data: elevenLabsInfo, isLoading: isLoadingConnection } = useQuery({
        queryKey: ['elevenlabs-connection', accountId],
        queryFn: () => getElevenLabsAccountInfoAction({ accountId }),
        staleTime: 1000 * 60 * 5, // 5 minutes
    });

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
                    },
                    voice_provider: voiceProvider as 'elevenlabs' | 'playht' | 'azure' | 'google',
                },
            });
        },
        onSuccess: () => {
            toast.success('Audio settings saved');
            queryClient.invalidateQueries({ queryKey: ['project', projectId] });
        },
        onError: (error) => {
            toast.error(error instanceof Error ? error.message : 'Failed to save settings');
        },
    });

    const isConnected = elevenLabsInfo?.isConnected;

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
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
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
                                        {elevenLabsInfo.characterLimit.toLocaleString()} characters used
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
                        <Speaker className="h-4 w-4 text-muted-foreground" />
                        <Label className="font-medium">Voice (Text-to-Speech)</Label>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                            <Label htmlFor="voice-provider">Provider</Label>
                            <Select
                                value={voiceProvider}
                                onValueChange={(value) => setVoiceProvider(value as 'elevenlabs' | 'playht' | 'azure' | 'google')}
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
                                disabled={!isConnected || voiceProvider !== 'elevenlabs'}
                            >
                                <SelectTrigger id="tts-model">
                                    <SelectValue placeholder="Select model" />
                                </SelectTrigger>
                                <SelectContent>
                                    {ELEVENLABS_MODELS.map((model) => (
                                        <SelectItem key={model.id} value={model.id}>
                                            <div className="flex items-center gap-2">
                                                <span>{model.name}</span>
                                                {model.recommended && (
                                                    <Badge variant="outline" className="text-xs">
                                                        Recommended
                                                    </Badge>
                                                )}
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {ttsModel && (
                                <p className="text-xs text-muted-foreground">
                                    {ELEVENLABS_MODELS.find((m) => m.id === ttsModel)?.description}
                                </p>
                            )}
                        </div>
                    </div>
                </div>

                <Separator />

                {/* SFX Settings */}
                <div className="space-y-4">
                    <div className="flex items-center gap-2">
                        <Volume2 className="h-4 w-4 text-muted-foreground" />
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
                                {ELEVENLABS_MODELS.map((model) => (
                                    <SelectItem key={model.id} value={model.id}>
                                        {model.name}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                <Separator />

                {/* Music Settings (Future) */}
                <div className="space-y-4 opacity-50">
                    <div className="flex items-center gap-2">
                        <Music className="h-4 w-4 text-muted-foreground" />
                        <Label className="font-medium">Music Generation</Label>
                        <Badge variant="outline">Coming Soon</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        Music generation settings will be available in a future update.
                    </p>
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
