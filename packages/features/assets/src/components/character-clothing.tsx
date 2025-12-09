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

interface CharacterClothingProps {
  form: UseFormReturn<CharacterFormData>;
}

export function CharacterClothing({ form }: CharacterClothingProps) {
  return (
    <FormField
      control={form.control}
      name="clothing"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Default Outfit</FormLabel>
          <FormControl>
            <Textarea
              placeholder="Describe the character's typical clothing, style, and accessories..."
              rows={4}
              {...field}
            />
          </FormControl>
          <FormDescription>
            This will be used as the default clothing in generated scenes
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
