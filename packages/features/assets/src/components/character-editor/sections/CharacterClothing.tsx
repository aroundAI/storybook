/**
 * Character Clothing Section (FILM-205)
 *
 * Form fields for character clothing and style.
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { Textarea } from '@kit/ui/textarea';

import type { CharacterFormData } from '../../../lib/schemas/character.schema';

/**
 * Character Clothing Section (FILM-205)
 *
 * Form fields for character clothing and style.
 */

/**
 * Character Clothing Section (FILM-205)
 *
 * Form fields for character clothing and style.
 */

/**
 * Character Clothing Section (FILM-205)
 *
 * Form fields for character clothing and style.
 */

/**
 * Character Clothing Section (FILM-205)
 *
 * Form fields for character clothing and style.
 */

interface CharacterClothingProps {
  form: UseFormReturn<CharacterFormData>;
  disabled?: boolean;
}

const STYLES = [
  { value: 'casual', label: 'Casual' },
  { value: 'formal', label: 'Formal' },
  { value: 'sporty', label: 'Sporty' },
  { value: 'vintage', label: 'Vintage' },
  { value: 'fantasy', label: 'Fantasy' },
  { value: 'modern', label: 'Modern' },
  { value: 'futuristic', label: 'Futuristic' },
  { value: 'period', label: 'Period/Historical' },
] as const;

export function CharacterClothing({ form, disabled }: CharacterClothingProps) {
  return (
    <div className="space-y-4">
      {/* Default Outfit */}
      <FormField
        control={form.control}
        name="clothingStyle.defaultOutfit"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Default Outfit</FormLabel>
            <FormControl>
              <Textarea
                {...field}
                value={field.value ?? ''}
                placeholder="Describe the character's typical outfit..."
                disabled={disabled}
                rows={3}
                data-test="character-outfit-input"
              />
            </FormControl>
            <FormDescription>
              What does this character typically wear?
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Style */}
        <FormField
          control={form.control}
          name="clothingStyle.style"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Style</FormLabel>
              <Select
                onValueChange={field.onChange}
                value={field.value ?? undefined}
                disabled={disabled}
              >
                <FormControl>
                  <SelectTrigger data-test="character-style-select">
                    <SelectValue placeholder="Select style" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {STYLES.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Colors (comma-separated) */}
        <FormField
          control={form.control}
          name="clothingStyle.colors"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Preferred Colors</FormLabel>
              <FormControl>
                <Input
                  value={field.value?.join(', ') ?? ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    const colors = value
                      ? value
                          .split(',')
                          .map((c) => c.trim())
                          .filter(Boolean)
                      : [];
                    field.onChange(colors);
                  }}
                  placeholder="navy, gray, white"
                  disabled={disabled}
                  data-test="character-colors-input"
                />
              </FormControl>
              <FormDescription>Comma-separated list.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* Accessories (comma-separated) */}
      <FormField
        control={form.control}
        name="clothingStyle.accessories"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Accessories</FormLabel>
            <FormControl>
              <Input
                value={field.value?.join(', ') ?? ''}
                onChange={(e) => {
                  const value = e.target.value;
                  const accessories = value
                    ? value
                        .split(',')
                        .map((a) => a.trim())
                        .filter(Boolean)
                    : [];
                  field.onChange(accessories);
                }}
                placeholder="watch, glasses, necklace"
                disabled={disabled}
                data-test="character-accessories-input"
              />
            </FormControl>
            <FormDescription>
              Items the character typically wears or carries.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
