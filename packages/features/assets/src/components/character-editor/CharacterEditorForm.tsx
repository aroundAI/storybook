'use client';

/**
 * Character Editor Form (FILM-205)
 *
 * Simplified form layout for character editing.
 * Focus on: name, description, reference image, and voice selection.
 */
import type { UseFormReturn } from 'react-hook-form';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@kit/ui/accordion';

import type { CharacterFormData } from '../../lib/schemas/character.schema';
import {
  CharacterBasicInfo,
  CharacterImageUpload,
  CharacterVoiceSelector,
} from './sections';

interface CharacterEditorFormProps {
  form: UseFormReturn<CharacterFormData>;
  disabled?: boolean;
  accountId: string;
}

export function CharacterEditorForm({
  form,
  disabled,
  projectId,
  assetId,
  accountId,
}: CharacterEditorFormProps & { projectId: string; assetId?: string }) {
  return (
    <div className="space-y-6">
      {/* Basic Info - Always visible */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Basic Information</h3>
        <CharacterBasicInfo form={form} disabled={disabled} />
      </div>

      {/* Character Image Upload - Always visible */}
      <CharacterImageUpload
        form={form}
        disabled={disabled}
        projectId={projectId}
        assetId={assetId}
      />

      {/* Voice Selection */}
      <Accordion type="multiple" defaultValue={['voice']} className="w-full">
        <AccordionItem value="voice">
          <AccordionTrigger data-test="character-voice-accordion">
            Voice Profile
          </AccordionTrigger>
          <AccordionContent>
            <CharacterVoiceSelector
              form={form}
              disabled={disabled}
              accountId={accountId}
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
