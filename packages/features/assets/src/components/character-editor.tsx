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
import type { Asset, CharacterMetadata } from '../lib/types';
import { CharacterEditorForm } from './character-editor-form';

// Character form schema
const CharacterFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().max(1000).optional(),
  physicalAttributes: z
    .object({
      age: z.string().optional(),
      gender: z.string().optional(),
      height: z.string().optional(),
      build: z.string().optional(),
      hairColor: z.string().optional(),
      eyeColor: z.string().optional(),
      distinctiveFeatures: z.string().optional(),
    })
    .optional(),
  personality: z.string().max(1000).optional(),
  clothing: z.string().max(1000).optional(),
  backstory: z.string().max(2000).optional(),
});

export type CharacterFormData = z.infer<typeof CharacterFormSchema>;

interface CharacterEditorProps {
  projectId: string;
  character?: Asset;
  onSuccess?: (characterId: string) => void;
  onCancel?: () => void;
}

export function CharacterEditor({
  projectId,
  character,
  onSuccess,
  onCancel,
}: CharacterEditorProps) {
  const [isPending, startTransition] = useTransition();
  const isEditMode = !!character;

  // Extract metadata if editing
  const existingMetadata = character?.metadata as CharacterMetadata | null;

  const form = useForm({
    resolver: zodResolver(CharacterFormSchema),
    defaultValues: {
      name: character?.name ?? '',
      description: character?.description ?? '',
      physicalAttributes: existingMetadata?.physicalAttributes ?? {
        age: '',
        gender: '',
        height: '',
        build: '',
        hairColor: '',
        eyeColor: '',
        distinctiveFeatures: '',
      },
      personality: existingMetadata?.personality ?? '',
      clothing: '', // Not in current metadata schema, but included for future
      backstory: existingMetadata?.backstory ?? '',
    },
  });

  const onSubmit = form.handleSubmit((data) => {
    startTransition(async () => {
      try {
        // Build metadata object
        const metadata: CharacterMetadata = {
          physicalAttributes: data.physicalAttributes,
          personality: data.personality,
          backstory: data.backstory,
        };

        if (isEditMode && character) {
          // Update existing character
          const result = await updateAssetAction({
            id: character.id,
            name: data.name,
            description: data.description,
            metadata: metadata as Record<string, unknown>,
          });

          if (result.success) {
            toast.success('Character updated successfully');
            form.reset();
            onSuccess?.(result.data.id);
          }
        } else {
          // Create new character
          const result = await createAssetAction({
            projectId,
            type: 'character',
            name: data.name,
            description: data.description,
            metadata: metadata as Record<string, unknown>,
          });

          if (result.success) {
            toast.success('Character created successfully');
            form.reset();
            onSuccess?.(result.data.id);
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Failed to save character';
        toast.error(message);
      }
    });
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-6">
        <CharacterEditorForm form={form} />

        {/* Actions */}
        <div className="flex justify-end gap-4 border-t pt-4">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditMode ? 'Update Character' : 'Create Character'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
