/**
 * Character Personality Section (FILM-205)
 *
 * Form fields for character personality traits.
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
 * Character Personality Section (FILM-205)
 *
 * Form fields for character personality traits.
 */

/**
 * Character Personality Section (FILM-205)
 *
 * Form fields for character personality traits.
 */

/**
 * Character Personality Section (FILM-205)
 *
 * Form fields for character personality traits.
 */

/**
 * Character Personality Section (FILM-205)
 *
 * Form fields for character personality traits.
 */

/**
 * Character Personality Section (FILM-205)
 *
 * Form fields for character personality traits.
 */

/**
 * Character Personality Section (FILM-205)
 *
 * Form fields for character personality traits.
 */

/**
 * Character Personality Section (FILM-205)
 *
 * Form fields for character personality traits.
 */

interface CharacterPersonalityProps {
  form: UseFormReturn<CharacterFormData>;
  disabled?: boolean;
}

export function CharacterPersonality({
  form,
  disabled,
}: CharacterPersonalityProps) {
  return (
    <div className="space-y-4">
      {/* General Personality Description */}
      <FormField
        control={form.control}
        name="personality"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Personality Description</FormLabel>
            <FormControl>
              <Textarea
                {...field}
                value={field.value ?? ''}
                placeholder="Describe the character's personality..."
                disabled={disabled}
                rows={4}
                data-test="character-personality-input"
              />
            </FormControl>
            <FormDescription>
              A general description of how this character behaves and thinks.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Traits (comma-separated) */}
        <FormField
          control={form.control}
          name="personalityTraits.traits"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Traits</FormLabel>
              <FormControl>
                <Input
                  value={field.value?.join(', ') ?? ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    const traits = value
                      ? value
                          .split(',')
                          .map((t) => t.trim())
                          .filter(Boolean)
                      : [];
                    field.onChange(traits);
                  }}
                  placeholder="brave, intelligent, cautious"
                  disabled={disabled}
                  data-test="character-traits-input"
                />
              </FormControl>
              <FormDescription>Comma-separated list of traits.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Mannerisms (comma-separated) */}
        <FormField
          control={form.control}
          name="personalityTraits.mannerisms"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Mannerisms</FormLabel>
              <FormControl>
                <Input
                  value={field.value?.join(', ') ?? ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    const mannerisms = value
                      ? value
                          .split(',')
                          .map((t) => t.trim())
                          .filter(Boolean)
                      : [];
                    field.onChange(mannerisms);
                  }}
                  placeholder="taps pen, clears throat"
                  disabled={disabled}
                  data-test="character-mannerisms-input"
                />
              </FormControl>
              <FormDescription>Habitual behaviors or gestures.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Strengths (comma-separated) */}
        <FormField
          control={form.control}
          name="personalityTraits.strengths"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Strengths</FormLabel>
              <FormControl>
                <Input
                  value={field.value?.join(', ') ?? ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    const strengths = value
                      ? value
                          .split(',')
                          .map((t) => t.trim())
                          .filter(Boolean)
                      : [];
                    field.onChange(strengths);
                  }}
                  placeholder="analytical, empathetic"
                  disabled={disabled}
                  data-test="character-strengths-input"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Weaknesses (comma-separated) */}
        <FormField
          control={form.control}
          name="personalityTraits.weaknesses"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Weaknesses</FormLabel>
              <FormControl>
                <Input
                  value={field.value?.join(', ') ?? ''}
                  onChange={(e) => {
                    const value = e.target.value;
                    const weaknesses = value
                      ? value
                          .split(',')
                          .map((t) => t.trim())
                          .filter(Boolean)
                      : [];
                    field.onChange(weaknesses);
                  }}
                  placeholder="impatient, stubborn"
                  disabled={disabled}
                  data-test="character-weaknesses-input"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      {/* Motivations */}
      <FormField
        control={form.control}
        name="personalityTraits.motivations"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Motivations</FormLabel>
            <FormControl>
              <Textarea
                {...field}
                value={field.value ?? ''}
                placeholder="What drives this character?"
                disabled={disabled}
                rows={2}
                data-test="character-motivations-input"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Fears */}
      <FormField
        control={form.control}
        name="personalityTraits.fears"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Fears</FormLabel>
            <FormControl>
              <Textarea
                {...field}
                value={field.value ?? ''}
                placeholder="What is this character afraid of?"
                disabled={disabled}
                rows={2}
                data-test="character-fears-input"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
