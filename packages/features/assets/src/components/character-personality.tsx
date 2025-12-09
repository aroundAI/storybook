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
import { Textarea } from '@kit/ui/textarea';

import type { CharacterFormData } from './character-editor';

interface CharacterPersonalityProps {
  form: UseFormReturn<CharacterFormData>;
}

export function CharacterPersonality({ form }: CharacterPersonalityProps) {
  const personality = form.watch('personality');
  const charCount = personality?.length ?? 0;

  return (
    <FormField
      control={form.control}
      name="personality"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Personality Traits</FormLabel>
          <FormControl>
            <Textarea
              placeholder="Describe the character's personality, traits, motivations, fears, strengths, and weaknesses..."
              rows={6}
              {...field}
            />
          </FormControl>
          <FormDescription className="flex justify-between">
            <span>Key personality traits and behavioral patterns</span>
            <span className={charCount > 1000 ? 'text-destructive' : ''}>
              {charCount} / 1000
            </span>
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
