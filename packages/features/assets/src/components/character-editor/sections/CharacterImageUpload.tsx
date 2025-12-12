/**
 * Character Image Upload Section (FILM-205)
 *
 * Image upload fields for character reference images.
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

import type { CharacterFormData } from '../../../lib/schemas/character.schema';

/**
 * Character Image Upload Section (FILM-205)
 *
 * Image upload fields for character reference images.
 */

/**
 * Character Image Upload Section (FILM-205)
 *
 * Image upload fields for character reference images.
 */

/**
 * Character Image Upload Section (FILM-205)
 *
 * Image upload fields for character reference images.
 */

/**
 * Character Image Upload Section (FILM-205)
 *
 * Image upload fields for character reference images.
 */

/**
 * Character Image Upload Section (FILM-205)
 *
 * Image upload fields for character reference images.
 */

/**
 * Character Image Upload Section (FILM-205)
 *
 * Image upload fields for character reference images.
 */

interface CharacterImageUploadProps {
  form: UseFormReturn<CharacterFormData>;
  disabled?: boolean;
}

export function CharacterImageUpload({
  form,
  disabled,
}: CharacterImageUploadProps) {
  return (
    <div className="space-y-4">
      {/* Main Image URL */}
      <FormField
        control={form.control}
        name="fileUrl"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Main Reference Image URL</FormLabel>
            <FormControl>
              <Input
                {...field}
                value={field.value ?? ''}
                type="url"
                placeholder="https://example.com/character-image.jpg"
                disabled={disabled}
                data-test="character-image-url-input"
              />
            </FormControl>
            <FormDescription>
              Primary reference image for this character.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Thumbnail URL */}
      <FormField
        control={form.control}
        name="thumbnailUrl"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Thumbnail URL</FormLabel>
            <FormControl>
              <Input
                {...field}
                value={field.value ?? ''}
                type="url"
                placeholder="https://example.com/character-thumb.jpg"
                disabled={disabled}
                data-test="character-thumbnail-url-input"
              />
            </FormControl>
            <FormDescription>
              Smaller image for gallery display (optional).
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Reference Images (for Kling AI) */}
      <FormField
        control={form.control}
        name="referenceImages"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Additional Reference Images</FormLabel>
            <FormControl>
              <Input
                value={field.value?.join(', ') ?? ''}
                onChange={(e) => {
                  const value = e.target.value;
                  const urls = value
                    ? value
                        .split(',')
                        .map((u) => u.trim())
                        .filter((u) => u.length > 0)
                    : [];
                  field.onChange(urls);
                }}
                placeholder="https://url1.jpg, https://url2.jpg"
                disabled={disabled}
                data-test="character-reference-images-input"
              />
            </FormControl>
            <FormDescription>
              Comma-separated list of additional reference image URLs for AI
              consistency (up to 10 images).
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
