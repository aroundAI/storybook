/**
 * Character Voice Selector Section (FILM-205)
 *
 * Dropdown to select a voice asset for the character.
 */

'use client';

import type { UseFormReturn } from 'react-hook-form';

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

import type { CharacterFormData } from '../../../lib/schemas/character.schema';
import type { VoiceAssetOption } from '../../../lib/types';

/**
 * Character Voice Selector Section (FILM-205)
 *
 * Dropdown to select a voice asset for the character.
 */

/**
 * Character Voice Selector Section (FILM-205)
 *
 * Dropdown to select a voice asset for the character.
 */

interface CharacterVoiceSelectorProps {
  form: UseFormReturn<CharacterFormData>;
  disabled?: boolean;
  voiceAssets: VoiceAssetOption[];
}

export function CharacterVoiceSelector({
  form,
  disabled,
  voiceAssets,
}: CharacterVoiceSelectorProps) {
  return (
    <div className="space-y-4">
      <FormField
        control={form.control}
        name="voiceAssetId"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Voice Profile</FormLabel>
            <Select
              onValueChange={(value) =>
                field.onChange(value === '_none' ? null : value)
              }
              value={field.value ?? '_none'}
              disabled={disabled}
            >
              <FormControl>
                <SelectTrigger data-test="character-voice-select">
                  <SelectValue placeholder="Select a voice profile" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="_none">No voice profile</SelectItem>
                {voiceAssets.map((voice) => (
                  <SelectItem key={voice.id} value={voice.id}>
                    {voice.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormDescription>
              {voiceAssets.length === 0
                ? 'No voice profiles available. Create one in the Voice assets section.'
                : 'Select a voice profile for this character.'}
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
