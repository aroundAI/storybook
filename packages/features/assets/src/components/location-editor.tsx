'use client';

import { useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@kit/ui/button';
import { Form } from '@kit/ui/form';
import { toast } from '@kit/ui/sonner';

import {
  createAssetAction,
  updateAssetAction,
} from '../lib/server/asset.mutations';
import type { Asset, LocationMetadata } from '../lib/types';
import { LocationEditorForm } from './location-editor-form';

// Location form schema
const LocationFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().max(1000).optional(),
  fileUrl: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  setting: z.string().optional(),
  timeOfDay: z.string().optional(),
  weather: z.string().optional(),
  atmosphere: z.string().optional(),
  referenceImages: z.array(z.string()).optional(),
});

export type LocationFormData = z.infer<typeof LocationFormSchema>;

interface LocationEditorProps {
  projectId: string;
  location?: Asset;
  onSuccess?: (locationId: string) => void;
  onCancel?: () => void;
}

export function LocationEditor({
  projectId,
  location,
  onSuccess,
  onCancel,
}: LocationEditorProps) {
  const [isPending, startTransition] = useTransition();
  const isEditMode = !!location;

  // Extract metadata if editing
  const existingMetadata = location?.metadata as LocationMetadata | null;

  const form = useForm({
    resolver: zodResolver(LocationFormSchema),
    defaultValues: {
      name: location?.name ?? '',
      description: location?.description ?? '',
      fileUrl: location?.fileUrl ?? '',
      thumbnailUrl: location?.thumbnailUrl ?? '',
      setting: existingMetadata?.setting ?? '',
      timeOfDay: existingMetadata?.timeOfDay ?? '',
      weather: existingMetadata?.weather ?? '',
      atmosphere: existingMetadata?.atmosphere ?? '',
      referenceImages: existingMetadata?.referenceImages ?? [],
    },
  });

  const onSubmit = form.handleSubmit((data) => {
    startTransition(async () => {
      try {
        // Build metadata object
        const metadata: LocationMetadata = {
          setting: data.setting,
          timeOfDay: data.timeOfDay,
          weather: data.weather,
          atmosphere: data.atmosphere,
          referenceImages: data.referenceImages,
        };

        if (isEditMode && location) {
          // Update existing location
          const result = await updateAssetAction({
            id: location.id,
            name: data.name,
            description: data.description,
            fileUrl: data.fileUrl,
            thumbnailUrl: data.thumbnailUrl,
            metadata: metadata as Record<string, unknown>,
          });

          if (result.success) {
            toast.success('Location updated successfully');
            form.reset();
            onSuccess?.(result.data.id);
          }
        } else {
          // Create new location
          const result = await createAssetAction({
            projectId,
            type: 'location',
            name: data.name,
            description: data.description,
            fileUrl: data.fileUrl,
            thumbnailUrl: data.thumbnailUrl,
            metadata: metadata as Record<string, unknown>,
          });

          if (result.success) {
            toast.success('Location created successfully');
            form.reset();
            onSuccess?.(result.data.id);
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to save location';
        toast.error(message);
      }
    });
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-6">
        <LocationEditorForm
          form={form}
          projectId={projectId}
          assetId={location?.id}
        />

        {/* Actions */}
        <div className="flex justify-end gap-4 border-t pt-4">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button
            type="submit"
            disabled={isPending}
            data-test="location-submit"
          >
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditMode ? 'Update Location' : 'Create Location'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
