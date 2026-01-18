'use client';

import { useState, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Alert, AlertDescription } from '@kit/ui/alert';
import { Button } from '@kit/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import { Skeleton } from '@kit/ui/skeleton';
import { toast } from '@kit/ui/sonner';

import {
  createAssetAction,
  updateAssetAction,
} from '../lib/server/asset.mutations';
import {
  type ElevenLabsVoice,
  getElevenLabsVoicesAction,
} from '../lib/server/voice.actions';
import type { Asset, VoiceMetadata } from '../lib/types';
import type { VoiceOption } from './voice-card';
import { VoicePreview } from './voice-preview';
import { VoiceSelector } from './voice-selector';
import { VoiceSettings, type VoiceSettingsData } from './voice-settings';

// Voice profile form schema
const VoiceProfileFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  voiceId: z.string().min(1, 'Please select a voice'),
  provider: z.enum(['elevenlabs', 'playht', 'azure', 'google', 'custom']),
  settings: z.object({
    stability: z.number().min(0).max(1),
    similarityBoost: z.number().min(0).max(1),
    style: z.number().min(0).max(1).optional(),
    useSpeakerBoost: z.boolean().optional(),
  }),
});

// Sample voices for demo (in production, these would come from ElevenLabs API)
const _SAMPLE_VOICES: VoiceOption[] = [
  {
    id: 'voice-1',
    name: 'Adam',
    gender: 'Male',
    age: 'Middle Aged',
    accent: 'American',
    description: 'A warm and friendly male voice, perfect for narration.',
    category: 'premade',
  },
  {
    id: 'voice-2',
    name: 'Rachel',
    gender: 'Female',
    age: 'Young',
    accent: 'British',
    description: 'A clear and articulate female voice with British accent.',
    category: 'premade',
  },
  {
    id: 'voice-3',
    name: 'Marcus',
    gender: 'Male',
    age: 'Elderly',
    accent: 'American',
    description: 'A deep and authoritative voice for dramatic content.',
    category: 'premade',
  },
  {
    id: 'voice-4',
    name: 'Sophia',
    gender: 'Female',
    age: 'Young',
    accent: 'American',
    description: 'A cheerful and energetic voice for upbeat content.',
    category: 'premade',
  },
];

interface VoiceProfileEditorProps {
  projectId: string;
  accountId: string;
  voiceProfile?: Asset;
  onSuccess?: (voiceProfileId: string) => void;
  onCancel?: () => void;
}

export function VoiceProfileEditor({
  projectId,
  accountId,
  voiceProfile,
  onSuccess,
  onCancel,
}: VoiceProfileEditorProps) {
  const [isPending, startTransition] = useTransition();
  const [previewAudioUrl, setPreviewAudioUrl] = useState<string | null>(null);
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);

  // Fetch voices from ElevenLabs
  const {
    data: voicesData,
    isLoading: voicesLoading,
    error: voicesError,
  } = useQuery({
    queryKey: ['elevenlabs-voices', accountId],
    queryFn: () => getElevenLabsVoicesAction({ accountId }),
    enabled: !!accountId,
  });

  // Transform API voices to VoiceOption format
  const voices: VoiceOption[] =
    voicesData?.voices?.map((v: ElevenLabsVoice) => ({
      id: v.id,
      name: v.name,
      gender:
        v.gender === 'male'
          ? 'Male'
          : v.gender === 'female'
            ? 'Female'
            : 'Neutral',
      age: v.age || 'Unknown',
      accent: v.accent || 'Neutral',
      description: v.description,
      category: v.isCloned ? 'cloned' : 'premade',
      previewUrl: v.previewUrl,
    })) ?? [];

  const isEditMode = !!voiceProfile;
  const existingMetadata = voiceProfile?.metadata as VoiceMetadata | null;

  const form = useForm({
    resolver: zodResolver(VoiceProfileFormSchema),
    defaultValues: {
      name: voiceProfile?.name ?? '',
      voiceId: existingMetadata?.providerVoiceId ?? '',
      provider: existingMetadata?.provider ?? ('elevenlabs' as const),
      settings: {
        stability: 0.5,
        similarityBoost: 0.75,
        style: 0,
        useSpeakerBoost: true,
        ...(existingMetadata?.settings as VoiceSettingsData | undefined),
      },
    },
  });

  const selectedVoiceId = form.watch('voiceId');
  const settings = form.watch('settings');

  // Generate preview using the selected voice's preview URL
  const handleGeneratePreview = async () => {
    if (!selectedVoiceId) {
      toast.error('Please select a voice first');
      return;
    }

    setIsGeneratingPreview(true);

    // Find the selected voice and use its preview URL
    const selectedVoice = voices.find((v) => v.id === selectedVoiceId);
    if (selectedVoice?.previewUrl) {
      setPreviewAudioUrl(selectedVoice.previewUrl);
      toast.success('Preview loaded');
    } else {
      toast.info('No preview available for this voice');
    }
    setIsGeneratingPreview(false);
  };

  const onSubmit = form.handleSubmit((data) => {
    startTransition(async () => {
      try {
        const metadata: VoiceMetadata = {
          provider: data.provider,
          providerVoiceId: data.voiceId,
          settings: data.settings,
        };

        if (isEditMode && voiceProfile) {
          const result = await updateAssetAction({
            id: voiceProfile.id,
            name: data.name,
            metadata: metadata as Record<string, unknown>,
          });

          if (result.success) {
            toast.success('Voice profile updated successfully');
            form.reset();
            onSuccess?.(result.data.id);
          }
        } else {
          const result = await createAssetAction({
            projectId,
            type: 'voice',
            name: data.name,
            metadata: metadata as Record<string, unknown>,
          });

          if (result.success) {
            toast.success('Voice profile created successfully');
            form.reset();
            onSuccess?.(result.data.id);
          }
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : 'Failed to save voice profile';
        toast.error(message);
      }
    });
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-6">
        {/* Name */}
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Profile Name *</FormLabel>
              <FormControl>
                <Input placeholder="e.g., Hero Voice" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Voice Selection */}
        <div className="space-y-2">
          <FormLabel>Select Voice *</FormLabel>
          {voicesLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : voicesError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {voicesError instanceof Error
                  ? voicesError.message
                  : 'Failed to load voices. Please check your ElevenLabs API key.'}
              </AlertDescription>
            </Alert>
          ) : (
            <VoiceSelector
              voices={voices}
              selectedVoiceId={selectedVoiceId}
              onSelect={(voiceId) => form.setValue('voiceId', voiceId)}
            />
          )}
          {form.formState.errors.voiceId && (
            <p className="text-destructive text-sm">
              {form.formState.errors.voiceId.message}
            </p>
          )}
        </div>

        {/* Voice Settings */}
        <VoiceSettings
          settings={settings}
          onChange={(newSettings) => form.setValue('settings', newSettings)}
        />

        {/* Voice Preview */}
        <div className="space-y-2">
          <FormLabel>Preview</FormLabel>
          <VoicePreview
            audioUrl={previewAudioUrl}
            isGenerating={isGeneratingPreview}
            onGenerate={handleGeneratePreview}
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-4 border-t pt-4">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditMode ? 'Update Profile' : 'Create Profile'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
