/**
 * Character Voice Selector Section
 *
 * Dropdown to select an ElevenLabs voice for the character.
 * Fetches voices directly from the ElevenLabs API.
 */

'use client';

import type { UseFormReturn } from 'react-hook-form';

import { useQuery } from '@tanstack/react-query';
import { AlertCircle, Volume2 } from 'lucide-react';

import { Alert, AlertDescription } from '@kit/ui/alert';
import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { Skeleton } from '@kit/ui/skeleton';

import type { CharacterFormData } from '../../../lib/schemas/character.schema';
import {
  getElevenLabsVoicesAction,
  type ElevenLabsVoice,
} from '../../../lib/server/voice.actions';

interface CharacterVoiceSelectorProps {
  form: UseFormReturn<CharacterFormData>;
  disabled?: boolean;
  accountId: string;
}

export function CharacterVoiceSelector({
  form,
  disabled,
  accountId,
}: CharacterVoiceSelectorProps) {
  // Fetch voices from ElevenLabs API
  const {
    data: voicesData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['elevenlabs-voices', accountId],
    queryFn: () => getElevenLabsVoicesAction({ accountId }),
    enabled: !!accountId,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  const voices: ElevenLabsVoice[] = voicesData?.voices ?? [];

  // Debug: log current form value and available voices
  const currentValue = form.watch('voiceAssetId');
  console.log('[VoiceSelector] Current form value:', currentValue);
  console.log('[VoiceSelector] Available voices:', voices.map(v => ({ id: v.id, name: v.name })));

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-4 w-48" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          Failed to load ElevenLabs voices. Please check your API key in
          Settings.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <FormField
        control={form.control}
        name="voiceAssetId"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="flex items-center gap-2">
              <Volume2 className="h-4 w-4" />
              ElevenLabs Voice
            </FormLabel>
            <Select
              onValueChange={(value) =>
                field.onChange(value === '_none' ? null : value)
              }
              value={field.value ?? '_none'}
              disabled={disabled || isLoading}
            >
              <FormControl>
                <SelectTrigger data-test="character-voice-select">
                  <SelectValue placeholder="Select an ElevenLabs voice" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="_none">No voice selected</SelectItem>
                {voices.map((voice) => (
                  <SelectItem key={voice.id} value={voice.id}>
                    <div className="flex items-center gap-2">
                      <span>{voice.name}</span>
                      {voice.isCloned && (
                        <span className="text-muted-foreground text-xs">
                          (cloned)
                        </span>
                      )}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormDescription>
              {voices.length === 0
                ? 'No voices found in your ElevenLabs account.'
                : 'Select a voice from your ElevenLabs account for this character.'}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}

