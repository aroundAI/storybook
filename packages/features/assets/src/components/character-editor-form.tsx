'use client';

import type { UseFormReturn } from 'react-hook-form';

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@kit/ui/accordion';

import { CharacterBackstory } from './character-backstory';
import { CharacterBasicInfo } from './character-basic-info';
import { CharacterClothing } from './character-clothing';
import type { CharacterFormData } from './character-editor';
import { CharacterPersonality } from './character-personality';
import { CharacterPhysicalAttributes } from './character-physical-attributes';

interface CharacterEditorFormProps {
  form: UseFormReturn<CharacterFormData>;
}

export function CharacterEditorForm({ form }: CharacterEditorFormProps) {
  return (
    <div className="space-y-6">
      {/* Basic Info - Always visible */}
      <div className="space-y-4">
        <h3 className="text-lg font-semibold">Basic Information</h3>
        <CharacterBasicInfo form={form} />
      </div>

      {/* Accordion Sections */}
      <Accordion
        type="multiple"
        defaultValue={['physical', 'personality', 'clothing', 'backstory']}
        className="w-full"
      >
        {/* Physical Attributes */}
        <AccordionItem value="physical">
          <AccordionTrigger>Physical Attributes</AccordionTrigger>
          <AccordionContent className="pt-4">
            <CharacterPhysicalAttributes form={form} />
          </AccordionContent>
        </AccordionItem>

        {/* Personality */}
        <AccordionItem value="personality">
          <AccordionTrigger>Personality</AccordionTrigger>
          <AccordionContent className="pt-4">
            <CharacterPersonality form={form} />
          </AccordionContent>
        </AccordionItem>

        {/* Clothing */}
        <AccordionItem value="clothing">
          <AccordionTrigger>Clothing &amp; Style</AccordionTrigger>
          <AccordionContent className="pt-4">
            <CharacterClothing form={form} />
          </AccordionContent>
        </AccordionItem>

        {/* Backstory */}
        <AccordionItem value="backstory">
          <AccordionTrigger>Backstory</AccordionTrigger>
          <AccordionContent className="pt-4">
            <CharacterBackstory form={form} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
