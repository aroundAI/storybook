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
import { ImageUploader } from '../../image-uploader/ImageUploader';

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
  projectId: string;
  assetId?: string;
}

export function CharacterImageUpload({
  form,
  disabled,
  projectId,
  assetId,
}: CharacterImageUploadProps) {
  const fileUrl = form.watch('fileUrl');
  const thumbnailUrl = form.watch('thumbnailUrl');

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-6 md:flex-row">
        {/* Main Image Uploader */}
        <div className="w-full shrink-0 md:w-64">
          <FormLabel className="mb-2 block">Visual Reference</FormLabel>
          <ImageUploader
            projectId={projectId}
            assetType="character"
            assetId={assetId}
            initialImageUrl={fileUrl}
            initialThumbnailUrl={thumbnailUrl}
            onUploadComplete={(url, thumb) => {
              form.setValue('fileUrl', url, {
                shouldValidate: true,
                shouldDirty: true,
              });
              form.setValue('thumbnailUrl', thumb, {
                shouldValidate: true,
                shouldDirty: true,
              });
            }}
            onRemove={() => {
              form.setValue('fileUrl', '', {
                shouldValidate: true,
                shouldDirty: true,
              });
              form.setValue('thumbnailUrl', '', {
                shouldValidate: true,
                shouldDirty: true,
              });
            }}
            disabled={disabled}
            className="h-64 w-full md:w-64"
          />
        </div>
      </div>

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
