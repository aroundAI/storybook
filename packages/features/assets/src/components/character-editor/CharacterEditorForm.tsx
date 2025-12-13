/**
 * Character Editor Form (FILM-205)
 *
 * Form layout with accordion sections for character editing.
 */

'use client';

import type { UseFormReturn } from 'react-hook-form';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@kit/ui/accordion';

import type { CharacterFormData } from '../../lib/schemas/character.schema';
import type { VoiceAssetOption } from '../../lib/types';
import {
  CharacterBackstory,
  CharacterBasicInfo,
  CharacterClothing,
  CharacterImageUpload,
  CharacterPersonality,
  CharacterPhysicalAttributes,
  CharacterVoiceSelector,
} from './sections';

/**
 * Character Editor Form (FILM-205)
 *
 * Form layout with accordion sections for character editing.
 */

/**
 * Character Editor Form (FILM-205)
 *
 * Form layout with accordion sections for character editing.
 */

/**
 * Character Editor Form (FILM-205)
 *
 * Form layout with accordion sections for character editing.
 */

/**
 * Character Editor Form (FILM-205)
 *
 * Form layout with accordion sections for character editing.
 */

/**
 * Character Editor Form (FILM-205)
 *
 * Form layout with accordion sections for character editing.
 */

/**
 * Character Editor Form (FILM-205)
 *
 * Form layout with accordion sections for character editing.
 */

interface CharacterEditorFormProps {
  form: UseFormReturn<CharacterFormData>;
  disabled?: boolean;
  voiceAssets?: VoiceAssetOption[];
}

export function CharacterEditorForm({
  form,
  disabled,
  voiceAssets = [],
  projectId,
  assetId,
}: CharacterEditorFormProps & { projectId: string; assetId?: string }) {
  return (
    <div className="space-y-6">
      {/* Basic Info - Always visible */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Basic Information</h3>
        <CharacterBasicInfo form={form} disabled={disabled} />
      </div>

      {/* Image Upload - Always visible */}
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Reference Images</h3>
        <CharacterImageUpload
          form={form}
          disabled={disabled}
          projectId={projectId}
          assetId={assetId}
        />
      </div>

      {/* Collapsible Sections */}
      <Accordion type="multiple" defaultValue={['physical']} className="w-full">
        {/* Physical Attributes */}
        <AccordionItem value="physical">
          <AccordionTrigger data-test="character-physical-accordion">
            Physical Attributes
          </AccordionTrigger>
          <AccordionContent>
            <CharacterPhysicalAttributes form={form} disabled={disabled} />
          </AccordionContent>
        </AccordionItem>

        {/* Personality */}
        <AccordionItem value="personality">
          <AccordionTrigger data-test="character-personality-accordion">
            Personality
          </AccordionTrigger>
          <AccordionContent>
            <CharacterPersonality form={form} disabled={disabled} />
          </AccordionContent>
        </AccordionItem>

        {/* Clothing */}
        <AccordionItem value="clothing">
          <AccordionTrigger data-test="character-clothing-accordion">
            Clothing & Style
          </AccordionTrigger>
          <AccordionContent>
            <CharacterClothing form={form} disabled={disabled} />
          </AccordionContent>
        </AccordionItem>

        {/* Backstory */}
        <AccordionItem value="backstory">
          <AccordionTrigger data-test="character-backstory-accordion">
            Backstory & AI Prompt
          </AccordionTrigger>
          <AccordionContent>
            <CharacterBackstory form={form} disabled={disabled} />
          </AccordionContent>
        </AccordionItem>

        {/* Voice */}
        <AccordionItem value="voice">
          <AccordionTrigger data-test="character-voice-accordion">
            Voice Profile
          </AccordionTrigger>
          <AccordionContent>
            <CharacterVoiceSelector
              form={form}
              disabled={disabled}
              voiceAssets={voiceAssets}
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
