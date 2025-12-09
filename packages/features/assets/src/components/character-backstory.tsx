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

interface CharacterBackstoryProps {
  form: UseFormReturn<CharacterFormData>;
}

export function CharacterBackstory({ form }: CharacterBackstoryProps) {
  const backstory = form.watch('backstory');
  const charCount = backstory?.length ?? 0;

  return (
    <FormField
      control={form.control}
      name="backstory"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Backstory</FormLabel>
          <FormControl>
            <Textarea
              placeholder="Write the character's background story, history, and important life events..."
              rows={8}
              {...field}
            />
          </FormControl>
          <FormDescription className="flex justify-between">
            <span>The character&apos;s history and background</span>
            <span className={charCount > 2000 ? 'text-destructive' : ''}>
              {charCount} / 2000
            </span>
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
