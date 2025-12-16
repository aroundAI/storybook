/**
 * Character Backstory Section (FILM-205)
 *
 * Form fields for character backstory and element prompt.
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
import { Textarea } from '@kit/ui/textarea';

import type { CharacterFormData } from '../../../lib/schemas/character.schema';

/**
 * Character Backstory Section (FILM-205)
 *
 * Form fields for character backstory and element prompt.
 */

/**
 * Character Backstory Section (FILM-205)
 *
 * Form fields for character backstory and element prompt.
 */

/**
 * Character Backstory Section (FILM-205)
 *
 * Form fields for character backstory and element prompt.
 */

/**
 * Character Backstory Section (FILM-205)
 *
 * Form fields for character backstory and element prompt.
 */

/**
 * Character Backstory Section (FILM-205)
 *
 * Form fields for character backstory and element prompt.
 */

/**
 * Character Backstory Section (FILM-205)
 *
 * Form fields for character backstory and element prompt.
 */

/**
 * Character Backstory Section (FILM-205)
 *
 * Form fields for character backstory and element prompt.
 */

interface CharacterBackstoryProps {
  form: UseFormReturn<CharacterFormData>;
  disabled?: boolean;
}

export function CharacterBackstory({
  form,
  disabled,
}: CharacterBackstoryProps) {
  const backstory = form.watch('backstory') ?? '';

  return (
    <div className="space-y-4">
      {/* Backstory */}
      <FormField
        control={form.control}
        name="backstory"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Backstory</FormLabel>
            <FormControl>
              <Textarea
                {...field}
                value={field.value ?? ''}
                placeholder="Write the character's backstory..."
                disabled={disabled}
                rows={8}
                data-test="character-backstory-input"
              />
            </FormControl>
            <div className="flex justify-between">
              <FormDescription>
                The character&apos;s history, background, and important life
                events.
              </FormDescription>
              <span className="text-muted-foreground text-xs">
                {backstory.length}/5000
              </span>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Element Prompt (for Kling AI) */}
      <FormField
        control={form.control}
        name="elementPrompt"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Element Prompt (AI Generation)</FormLabel>
            <FormControl>
              <Textarea
                {...field}
                value={field.value ?? ''}
                placeholder="Describe the character for AI video generation..."
                disabled={disabled}
                rows={4}
                data-test="character-element-prompt-input"
              />
            </FormControl>
            <FormDescription>
              This prompt is used by Kling AI to maintain character consistency
              across video generations. Focus on distinctive visual features.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
