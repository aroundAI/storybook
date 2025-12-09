/**
 * Character Editor (FILM-205)
 *
 * Main editor component for creating and editing characters.
 * Features: auto-save, draft restoration, unsaved changes warning.
 */

'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';

import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Form } from '@kit/ui/form';
import { toast } from '@kit/ui/sonner';

import { useAutoSave } from '../../hooks/use-auto-save';
import { useUnsavedChanges } from '../../hooks/use-unsaved-changes';
import {
  type CharacterFormData,
  CharacterFormSchema,
} from '../../lib/schemas/character.schema';
import {
  createCharacterAction,
  updateCharacterAction,
} from '../../lib/server/character.mutations';
import type { CharacterWithDetails, VoiceAssetOption } from '../../lib/types';
import { CharacterEditorForm } from './CharacterEditorForm';

interface CharacterEditorProps {
  /** Project ID for new characters */
  projectId: string;
  /** Existing character data for editing mode */
  character?: CharacterWithDetails | null;
  /** Available voice assets for the project */
  voiceAssets?: VoiceAssetOption[];
  /** Callback after successful save */
  onSuccess?: (character: CharacterWithDetails) => void;
  /** Callback to cancel/close the editor */
  onCancel?: () => void;
}

type FormMode = 'create' | 'edit';

/**
 * Transform CharacterWithDetails to form values
 */
function characterToFormData(
  character: CharacterWithDetails,
): CharacterFormData {
  return {
    name: character.name,
    description: character.description ?? '',
    fileUrl: character.fileUrl ?? '',
    thumbnailUrl: character.thumbnailUrl ?? '',
    physicalAttributes: character.physicalAttributes ?? undefined,
    personality: character.personality ?? '',
    personalityTraits: character.personalityTraits ?? undefined,
    clothingStyle: character.clothingStyle ?? undefined,
    backstory: character.backstory ?? '',
    elementPrompt: character.elementPrompt ?? '',
    referenceImages: character.referenceImages ?? [],
    voiceAssetId: character.voiceAssetId ?? null,
  };
}

/**
 * Default form values for new character
 */
function getDefaultFormValues(): CharacterFormData {
  return {
    name: '',
    description: '',
    fileUrl: '',
    thumbnailUrl: '',
    physicalAttributes: {},
    personality: '',
    personalityTraits: {},
    clothingStyle: {},
    backstory: '',
    elementPrompt: '',
    referenceImages: [],
    voiceAssetId: null,
  };
}

export function CharacterEditor({
  projectId,
  character,
  voiceAssets = [],
  onSuccess,
  onCancel,
}: CharacterEditorProps) {
  const [isPending, startTransition] = useTransition();
  const [showRestorePrompt, setShowRestorePrompt] = useState(false);
  const mode: FormMode = character ? 'edit' : 'create';

  // Initialize form with existing character data or defaults
  const form = useForm({
    resolver: zodResolver(CharacterFormSchema),
    defaultValues: character
      ? characterToFormData(character)
      : getDefaultFormValues(),
  });

  const storageKey = character
    ? `character-edit-${character.id}`
    : `character-create-${projectId}`;

  // Watch form values for auto-save (reactive updates)
  const formValues = form.watch();

  // Auto-save hook
  const { restore, clear, hasSavedData, save } = useAutoSave({
    storageKey,
    data: formValues,
    interval: 30000, // 30 seconds
    enabled: !isPending,
  });

  // Unsaved changes warning
  useUnsavedChanges({
    hasChanges: form.formState.isDirty,
    enabled: !isPending,
  });

  // Check for saved draft on mount
  useEffect(() => {
    if (hasSavedData()) {
      setShowRestorePrompt(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleRestoreDraft = useCallback(() => {
    const savedData = restore();
    if (savedData) {
      form.reset(savedData as CharacterFormData);
      toast.success('Draft restored successfully');
    }
    setShowRestorePrompt(false);
  }, [restore, form]);

  const handleDiscardDraft = useCallback(() => {
    clear();
    setShowRestorePrompt(false);
  }, [clear]);

  const onSubmit = form.handleSubmit((data) => {
    startTransition(async () => {
      try {
        let result;

        if (mode === 'edit' && character) {
          result = await updateCharacterAction({
            assetId: character.id,
            name: data.name,
            description: data.description || null,
            fileUrl: data.fileUrl || null,
            thumbnailUrl: data.thumbnailUrl || null,
            physicalAttributes: data.physicalAttributes,
            personality: data.personality || null,
            personalityTraits: data.personalityTraits,
            clothingStyle: data.clothingStyle,
            backstory: data.backstory || null,
            elementPrompt: data.elementPrompt || null,
            referenceImages: data.referenceImages,
            voiceAssetId: data.voiceAssetId,
          });
        } else {
          result = await createCharacterAction({
            projectId,
            name: data.name,
            description: data.description || undefined,
            fileUrl: data.fileUrl || undefined,
            thumbnailUrl: data.thumbnailUrl || undefined,
            physicalAttributes: data.physicalAttributes,
            personality: data.personality || undefined,
            personalityTraits: data.personalityTraits,
            clothingStyle: data.clothingStyle,
            backstory: data.backstory || undefined,
            elementPrompt: data.elementPrompt || undefined,
            referenceImages: data.referenceImages,
            voiceAssetId: data.voiceAssetId,
          });
        }

        if (result.success && result.data) {
          // Clear auto-saved draft
          clear();

          // Reset form after successful creation to allow creating another
          if (mode === 'create') {
            form.reset(getDefaultFormValues());
          }

          toast.success(
            mode === 'edit'
              ? 'Character updated successfully'
              : 'Character created successfully',
          );

          onSuccess?.(result.data);
        }
      } catch (error) {
        toast.error(
          `Failed to ${mode === 'edit' ? 'update' : 'create'} character: ${
            error instanceof Error ? error.message : 'Unknown error'
          }`,
        );
      }
    });
  });

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>
          {mode === 'edit' ? 'Edit Character' : 'Create Character'}
        </CardTitle>
        <CardDescription>
          {mode === 'edit'
            ? 'Update the character details below.'
            : 'Fill in the details to create a new character.'}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {/* Draft restore prompt */}
        {showRestorePrompt && (
          <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 p-4 dark:border-yellow-800 dark:bg-yellow-900/20">
            <p className="mb-3 text-sm text-yellow-800 dark:text-yellow-200">
              A draft was found from a previous session. Would you like to
              restore it?
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleRestoreDraft}
                data-test="restore-draft-button"
              >
                Restore Draft
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleDiscardDraft}
                data-test="discard-draft-button"
              >
                Discard
              </Button>
            </div>
          </div>
        )}

        <Form {...form}>
          <form onSubmit={onSubmit} className="space-y-6">
            <CharacterEditorForm
              form={form}
              disabled={isPending}
              voiceAssets={voiceAssets}
            />

            {/* Form actions */}
            <div className="flex justify-end gap-3 border-t pt-6">
              {onCancel && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onCancel}
                  disabled={isPending}
                  data-test="character-cancel-button"
                >
                  Cancel
                </Button>
              )}

              <Button
                type="button"
                variant="secondary"
                onClick={() => save()}
                disabled={isPending}
                data-test="character-save-draft-button"
              >
                Save Draft
              </Button>

              <Button
                type="submit"
                disabled={isPending}
                data-test="character-submit-button"
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving...
                  </>
                ) : mode === 'edit' ? (
                  'Save Changes'
                ) : (
                  'Create Character'
                )}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
