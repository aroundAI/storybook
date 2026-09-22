'use client';

import { UseFormReturn } from 'react-hook-form';

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
import { Textarea } from '@kit/ui/textarea';

import { ImageUploader } from './image-uploader/ImageUploader';
import { MultiImageUploader } from './image-uploader/MultiImageUploader';
import type { LocationFormData } from './location-editor';

interface LocationEditorFormProps {
  form: UseFormReturn<LocationFormData>;
  projectId: string;
  assetId?: string;
}

export function LocationEditorForm({
  form,
  projectId,
  assetId,
}: LocationEditorFormProps) {
  const fileUrl = form.watch('fileUrl');
  const thumbnailUrl = form.watch('thumbnailUrl');

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-6 md:flex-row">
        {/* Left Column: Image */}
        <div className="w-full shrink-0 space-y-6 md:w-64">
          <div>
            <FormLabel className="mb-2 block">Visual Reference</FormLabel>
            <ImageUploader
              projectId={projectId}
              assetType="location"
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
              className="h-48 w-full md:w-64"
            />
          </div>

          <div>
            <FormLabel className="mb-2 block">Additional References</FormLabel>
            <MultiImageUploader
              projectId={projectId}
              assetId={assetId}
              images={form.watch('referenceImages') || []}
              onImagesChange={(images) => {
                form.setValue('referenceImages', images, {
                  shouldValidate: true,
                  shouldDirty: true,
                });
              }}
            />
          </div>
        </div>

        {/* Right Column: Fields */}
        <div className="flex-1 space-y-4">
          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name *</FormLabel>
                <FormControl>
                  <Input
                    placeholder="e.g. The Old Library"
                    data-test="location-name-input"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="setting"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Setting</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select setting type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="interior">Interior</SelectItem>
                    <SelectItem value="exterior">Exterior</SelectItem>
                    <SelectItem value="space">Space</SelectItem>
                    <SelectItem value="fantasy">Fantasy</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="timeOfDay"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Time of Day</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Sunset" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="weather"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Weather</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g. Rainy" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="atmosphere"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Atmosphere/Mood</FormLabel>
                <FormControl>
                  <Input placeholder="e.g. Eerie, Cozy" {...field} />
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
                    placeholder="Detailed description of the location..."
                    rows={4}
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>
    </div>
  );
}
