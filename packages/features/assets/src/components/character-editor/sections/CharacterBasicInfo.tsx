/**
 * Character Basic Info Section (FILM-205)
 *
 * Form fields for character name and description.
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
import { Input } from '@kit/ui/input';
import { Textarea } from '@kit/ui/textarea';

import type { CharacterFormData } from '../../../lib/schemas/character.schema';

/**
 * Character Basic Info Section (FILM-205)
 *
 * Form fields for character name and description.
 */

/**
 * Character Basic Info Section (FILM-205)
 *
 * Form fields for character name and description.
 */

/**
 * Character Basic Info Section (FILM-205)
 *
 * Form fields for character name and description.
 */

/**
 * Character Basic Info Section (FILM-205)
 *
 * Form fields for character name and description.
 */

/**
 * Character Basic Info Section (FILM-205)
 *
 * Form fields for character name and description.
 */

interface CharacterBasicInfoProps {
  form: UseFormReturn<CharacterFormData>;
  disabled?: boolean;
}

export function CharacterBasicInfo({
  form,
  disabled,
}: CharacterBasicInfoProps) {
  return (
    <div className="space-y-4">
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <Input
                {...field}
                placeholder="Character name"
                disabled={disabled}
                data-test="character-name-input"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="description"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Description</FormLabel>
            <FormControl>
              <Textarea
                {...field}
                value={field.value ?? ''}
                placeholder="Brief description of the character..."
                disabled={disabled}
                rows={3}
                data-test="character-description-input"
              />
            </FormControl>
            <FormDescription>
              A short summary of who this character is.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
