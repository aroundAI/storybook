/**
 * Character Physical Attributes Section (FILM-205)
 *
 * Form fields for character physical appearance.
 */

'use client';

import type { UseFormReturn } from 'react-hook-form';

import {
  FormControl,
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

import type { CharacterFormData } from '../../../lib/schemas/character.schema';

/**
 * Character Physical Attributes Section (FILM-205)
 *
 * Form fields for character physical appearance.
 */

/**
 * Character Physical Attributes Section (FILM-205)
 *
 * Form fields for character physical appearance.
 */

interface CharacterPhysicalAttributesProps {
  form: UseFormReturn<CharacterFormData>;
  disabled?: boolean;
}

const AGE_RANGES = [
  { value: 'child', label: 'Child (0-12)' },
  { value: 'teen', label: 'Teen (13-19)' },
  { value: 'young_adult', label: 'Young Adult (20-35)' },
  { value: 'adult', label: 'Adult (36-55)' },
  { value: 'senior', label: 'Senior (55+)' },
] as const;

const GENDERS = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'non_binary', label: 'Non-binary' },
  { value: 'other', label: 'Other' },
] as const;

const BUILDS = [
  { value: 'slim', label: 'Slim' },
  { value: 'athletic', label: 'Athletic' },
  { value: 'average', label: 'Average' },
  { value: 'heavy', label: 'Heavy' },
  { value: 'muscular', label: 'Muscular' },
] as const;

export function CharacterPhysicalAttributes({
  form,
  disabled,
}: CharacterPhysicalAttributesProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {/* Age Range */}
      <FormField
        control={form.control}
        name="physicalAttributes.ageRange"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Age Range</FormLabel>
            <Select
              onValueChange={field.onChange}
              value={field.value ?? undefined}
              disabled={disabled}
            >
              <FormControl>
                <SelectTrigger data-test="character-age-range-select">
                  <SelectValue placeholder="Select age range" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {AGE_RANGES.map(({ value, label }) => (
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

      {/* Age (specific) */}
      <FormField
        control={form.control}
        name="physicalAttributes.age"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Age (specific)</FormLabel>
            <FormControl>
              <Input
                type="number"
                min={0}
                max={150}
                {...field}
                value={field.value ?? ''}
                onChange={(e) =>
                  field.onChange(
                    e.target.value ? parseInt(e.target.value, 10) : undefined,
                  )
                }
                placeholder="Optional specific age"
                disabled={disabled}
                data-test="character-age-input"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Gender */}
      <FormField
        control={form.control}
        name="physicalAttributes.gender"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Gender</FormLabel>
            <Select
              onValueChange={field.onChange}
              value={field.value ?? undefined}
              disabled={disabled}
            >
              <FormControl>
                <SelectTrigger data-test="character-gender-select">
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {GENDERS.map(({ value, label }) => (
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

      {/* Build */}
      <FormField
        control={form.control}
        name="physicalAttributes.build"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Build</FormLabel>
            <Select
              onValueChange={field.onChange}
              value={field.value ?? undefined}
              disabled={disabled}
            >
              <FormControl>
                <SelectTrigger data-test="character-build-select">
                  <SelectValue placeholder="Select build" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {BUILDS.map(({ value, label }) => (
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

      {/* Height */}
      <FormField
        control={form.control}
        name="physicalAttributes.height"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Height</FormLabel>
            <FormControl>
              <Input
                {...field}
                value={field.value ?? ''}
                placeholder="e.g., 5'10&quot; or 178cm"
                disabled={disabled}
                data-test="character-height-input"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Ethnicity */}
      <FormField
        control={form.control}
        name="physicalAttributes.ethnicity"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Ethnicity</FormLabel>
            <FormControl>
              <Input
                {...field}
                value={field.value ?? ''}
                placeholder="e.g., Asian, Caucasian, etc."
                disabled={disabled}
                data-test="character-ethnicity-input"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Hair Color */}
      <FormField
        control={form.control}
        name="physicalAttributes.hairColor"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Hair Color</FormLabel>
            <FormControl>
              <Input
                {...field}
                value={field.value ?? ''}
                placeholder="e.g., Black, Blonde, etc."
                disabled={disabled}
                data-test="character-hair-color-input"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Hair Style */}
      <FormField
        control={form.control}
        name="physicalAttributes.hairStyle"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Hair Style</FormLabel>
            <FormControl>
              <Input
                {...field}
                value={field.value ?? ''}
                placeholder="e.g., Short, curly"
                disabled={disabled}
                data-test="character-hair-style-input"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Eye Color */}
      <FormField
        control={form.control}
        name="physicalAttributes.eyeColor"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Eye Color</FormLabel>
            <FormControl>
              <Input
                {...field}
                value={field.value ?? ''}
                placeholder="e.g., Brown, Blue, etc."
                disabled={disabled}
                data-test="character-eye-color-input"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Skin Tone */}
      <FormField
        control={form.control}
        name="physicalAttributes.skinTone"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Skin Tone</FormLabel>
            <FormControl>
              <Input
                {...field}
                value={field.value ?? ''}
                placeholder="e.g., Fair, Olive, Dark"
                disabled={disabled}
                data-test="character-skin-tone-input"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Facial Hair (full width) */}
      <FormField
        control={form.control}
        name="physicalAttributes.facialHair"
        render={({ field }) => (
          <FormItem className="sm:col-span-2">
            <FormLabel>Facial Hair</FormLabel>
            <FormControl>
              <Input
                {...field}
                value={field.value ?? ''}
                placeholder="e.g., Clean-shaven, Full beard"
                disabled={disabled}
                data-test="character-facial-hair-input"
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
