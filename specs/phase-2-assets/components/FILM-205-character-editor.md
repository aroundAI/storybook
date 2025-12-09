# FILM-205: Character Editor Component

**Status**: ✅ Completed (2025-12-08)
**Phase**: 2
**Priority**: P0
**Effort**: L (5-8 days)
**Dependencies**: FILM-202 (character actions), FILM-204 (AssetGallery)
**Blocks**: None

---

## Context

The Character Editor is a comprehensive form for creating and editing character assets. It provides input fields for all character attributes including physical characteristics, personality traits, clothing style, backstory, and voice profile association. The editor integrates with the ImageUploader for reference images and VoiceProfileEditor for voice selection.

This is the most complex editor in the asset management system due to the nested structure of character data (physical attributes, personality, clothing) and the need to coordinate with voice profile management.

---

## Requirements

### Functional Requirements

1. **Form Structure**
   - Basic info: name, description
   - Physical attributes: age, gender, ethnicity, build, hair, eyes, skin, distinctive features
   - Personality: traits, mannerisms, motivations, fears, strengths, weaknesses
   - Clothing: default outfit, style, colors, accessories
   - Backstory: character background (max 2000 chars)
   - Voice profile: select existing or create new
   - Reference image: upload or URL input

2. **Validation**
   - Real-time field validation with Zod
   - Display field-level errors
   - Disable submit until all errors resolved
   - Validate nested objects (physical attributes, personality, clothing)

3. **User Experience**
   - Accordion sections for organization (Basic, Physical, Personality, Clothing, Voice)
   - Auto-save draft to localStorage every 30 seconds
   - Restore draft on page load
   - Unsaved changes warning before navigation
   - Loading states during submission
   - Success/error notifications

4. **Image Upload**
   - Integrate ImageUploader component
   - Display image preview
   - Remove/replace image
   - Upload on form submit (not immediately)

5. **Voice Profile Integration**
   - Dropdown to select existing voice profiles
   - "Create New" button to open VoiceProfileEditor modal
   - Link newly created voice to character
   - Display voice preview (play sample)

### Non-Functional Requirements

- Form submission completes within 3 seconds
- Responsive layout (mobile to desktop)
- Keyboard navigation (tab order, shortcuts)
- Accessible (ARIA labels, error announcements)
- Type-safe with TypeScript

---

## Interface

### Component Props

```typescript
interface CharacterEditorProps {
  projectId: string;
  characterId?: string;          // If editing existing character
  onSuccess?: (characterId: string) => void;
  onCancel?: () => void;
}
```

### Form Schema

```typescript
import { z } from 'zod';
import {
  PhysicalAttributesSchema,
  PersonalityTraitsSchema,
  ClothingStyleSchema,
} from '../schemas/character.schema';

export const CharacterFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().max(1000).optional(),
  referenceImageUrl: z.string().url().optional().or(z.literal('')),
  voiceProfileId: z.string().uuid().optional().or(z.literal('')),
  physicalAttributes: PhysicalAttributesSchema.optional(),
  personality: PersonalityTraitsSchema.optional(),
  clothing: ClothingStyleSchema.optional(),
  backstory: z.string().max(2000).optional(),
});

export type CharacterFormData = z.infer<typeof CharacterFormSchema>;
```

---

## Implementation

### Component Structure

```
packages/features/assets/src/components/
├── CharacterEditor.tsx                  # Main editor (CREATE THIS)
├── CharacterEditorForm.tsx              # Form wrapper (CREATE THIS)
├── CharacterBasicInfo.tsx               # Basic fields section (CREATE THIS)
├── CharacterPhysicalAttributes.tsx      # Physical section (CREATE THIS)
├── CharacterPersonality.tsx             # Personality section (CREATE THIS)
├── CharacterClothing.tsx                # Clothing section (CREATE THIS)
├── CharacterBackstory.tsx               # Backstory section (CREATE THIS)
├── CharacterVoiceSelector.tsx           # Voice selection (CREATE THIS)
└── CharacterImageUpload.tsx             # Image upload section (CREATE THIS)
```

### Main Editor Component

**File**: `packages/features/assets/src/components/CharacterEditor.tsx`

```typescript
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from '@kit/ui/sonner';
import { Button } from '@kit/ui/button';
import { Form } from '@kit/ui/form';
import { Loader2 } from 'lucide-react';
import { CharacterFormSchema, CharacterFormData } from '../schemas/character-form.schema';
import { CharacterEditorForm } from './CharacterEditorForm';
import {
  createCharacterAction,
  getCharacterAction,
  updateCharacterAction,
} from '../lib/server/mutations/character-actions';
import { useAutoSave } from '../hooks/use-auto-save';
import { useUnsavedChanges } from '../hooks/use-unsaved-changes';

interface CharacterEditorProps {
  projectId: string;
  characterId?: string;
  onSuccess?: (characterId: string) => void;
  onCancel?: () => void;
}

export function CharacterEditor({
  projectId,
  characterId,
  onSuccess,
  onCancel,
}: CharacterEditorProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  // Fetch existing character if editing
  const { data: character, isLoading } = useQuery({
    queryKey: ['character', characterId],
    queryFn: () => getCharacterAction({ characterId: characterId! }),
    enabled: !!characterId,
  });

  // Form setup
  const form = useForm({
    resolver: zodResolver(CharacterFormSchema),
    defaultValues: {
      name: '',
      description: '',
      referenceImageUrl: '',
      voiceProfileId: '',
      physicalAttributes: {},
      personality: {},
      clothing: {},
      backstory: '',
    },
  });

  // Populate form when character data loads
  useEffect(() => {
    if (character) {
      form.reset({
        name: character.name,
        description: character.description ?? '',
        referenceImageUrl: character.referenceImageUrl ?? '',
        voiceProfileId: character.voiceProfileId ?? '',
        physicalAttributes: character.physicalAttributes ?? {},
        personality: character.personality ?? {},
        clothing: character.clothing ?? {},
        backstory: character.backstory ?? '',
      });
    }
  }, [character, form]);

  // Auto-save draft to localStorage
  useAutoSave('character-draft', form.watch(), 30000);

  // Warn on unsaved changes
  useUnsavedChanges(form.formState.isDirty);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: (data: CharacterFormData) =>
      createCharacterAction({
        projectId,
        ...data,
      }),
    onSuccess: (newCharacter) => {
      toast.success('Character created successfully');
      queryClient.invalidateQueries({ queryKey: ['assets', projectId] });
      form.reset();
      localStorage.removeItem('character-draft');

      if (onSuccess) {
        onSuccess(newCharacter.id);
      } else {
        router.push(`/projects/${projectId}/assets`);
      }
    },
    onError: (error) => {
      toast.error('Failed to create character');
      console.error('Create character error:', error);
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: (data: CharacterFormData) =>
      updateCharacterAction({
        characterId: characterId!,
        ...data,
      }),
    onSuccess: (updatedCharacter) => {
      toast.success('Character updated successfully');
      queryClient.invalidateQueries({ queryKey: ['character', characterId] });
      queryClient.invalidateQueries({ queryKey: ['assets', projectId] });
      form.reset(form.getValues()); // Mark as pristine

      if (onSuccess) {
        onSuccess(updatedCharacter.id);
      } else {
        router.push(`/projects/${projectId}/assets`);
      }
    },
    onError: (error) => {
      toast.error('Failed to update character');
      console.error('Update character error:', error);
    },
  });

  // Submit handler
  const onSubmit = (data: CharacterFormData) => {
    if (characterId) {
      updateMutation.mutate(data);
    } else {
      createMutation.mutate(data);
    }
  };

  // Loading state
  if (isLoading && characterId) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
        <CharacterEditorForm form={form} projectId={projectId} />

        {/* Actions */}
        <div className="flex justify-end gap-4 sticky bottom-0 bg-background py-4 border-t">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={isPending || !form.formState.isValid}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {characterId ? 'Update Character' : 'Create Character'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
```

### Form Sections Component

**File**: `packages/features/assets/src/components/CharacterEditorForm.tsx`

```typescript
'use client';

import { UseFormReturn } from 'react-hook-form';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@kit/ui/accordion';
import { CharacterBasicInfo } from './CharacterBasicInfo';
import { CharacterPhysicalAttributes } from './CharacterPhysicalAttributes';
import { CharacterPersonality } from './CharacterPersonality';
import { CharacterClothing } from './CharacterClothing';
import { CharacterBackstory } from './CharacterBackstory';
import { CharacterVoiceSelector } from './CharacterVoiceSelector';
import { CharacterImageUpload } from './CharacterImageUpload';
import { CharacterFormData } from '../schemas/character-form.schema';

interface CharacterEditorFormProps {
  form: UseFormReturn<CharacterFormData>;
  projectId: string;
}

export function CharacterEditorForm({ form, projectId }: CharacterEditorFormProps) {
  return (
    <div className="space-y-6">
      {/* Basic Info - Always visible */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Basic Information</h2>
        <CharacterBasicInfo form={form} />
      </div>

      {/* Image Upload */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Reference Image</h2>
        <CharacterImageUpload form={form} projectId={projectId} />
      </div>

      {/* Voice Profile */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Voice Profile</h2>
        <CharacterVoiceSelector form={form} projectId={projectId} />
      </div>

      {/* Accordion Sections */}
      <Accordion type="multiple" defaultValue={['physical', 'personality', 'clothing', 'backstory']}>
        {/* Physical Attributes */}
        <AccordionItem value="physical">
          <AccordionTrigger>Physical Attributes</AccordionTrigger>
          <AccordionContent>
            <CharacterPhysicalAttributes form={form} />
          </AccordionContent>
        </AccordionItem>

        {/* Personality */}
        <AccordionItem value="personality">
          <AccordionTrigger>Personality</AccordionTrigger>
          <AccordionContent>
            <CharacterPersonality form={form} />
          </AccordionContent>
        </AccordionItem>

        {/* Clothing */}
        <AccordionItem value="clothing">
          <AccordionTrigger>Clothing & Style</AccordionTrigger>
          <AccordionContent>
            <CharacterClothing form={form} />
          </AccordionContent>
        </AccordionItem>

        {/* Backstory */}
        <AccordionItem value="backstory">
          <AccordionTrigger>Backstory</AccordionTrigger>
          <AccordionContent>
            <CharacterBackstory form={form} />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
```

### Basic Info Section

**File**: `packages/features/assets/src/components/CharacterBasicInfo.tsx`

```typescript
'use client';

import { UseFormReturn } from 'react-hook-form';
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import { Textarea } from '@kit/ui/textarea';
import { CharacterFormData } from '../schemas/character-form.schema';

interface CharacterBasicInfoProps {
  form: UseFormReturn<CharacterFormData>;
}

export function CharacterBasicInfo({ form }: CharacterBasicInfoProps) {
  return (
    <div className="space-y-4">
      <FormField
        control={form.control}
        name="name"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Name *</FormLabel>
            <FormControl>
              <Input placeholder="Enter character name" {...field} />
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
                placeholder="Brief description of the character"
                rows={3}
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );
}
```

### Physical Attributes Section

**File**: `packages/features/assets/src/components/CharacterPhysicalAttributes.tsx`

```typescript
'use client';

import { UseFormReturn } from 'react-hook-form';
import { FormField, FormItem, FormLabel, FormControl, FormMessage } from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@kit/ui/select';
import { CharacterFormData } from '../schemas/character-form.schema';

interface CharacterPhysicalAttributesProps {
  form: UseFormReturn<CharacterFormData>;
}

export function CharacterPhysicalAttributes({ form }: CharacterPhysicalAttributesProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Age */}
      <FormField
        control={form.control}
        name="physicalAttributes.age"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Age</FormLabel>
            <FormControl>
              <Input
                type="number"
                placeholder="25"
                {...field}
                onChange={(e) => field.onChange(e.target.valueAsNumber)}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Age Range */}
      <FormField
        control={form.control}
        name="physicalAttributes.ageRange"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Age Range</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select range" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="child">Child</SelectItem>
                <SelectItem value="teen">Teen</SelectItem>
                <SelectItem value="young_adult">Young Adult</SelectItem>
                <SelectItem value="adult">Adult</SelectItem>
                <SelectItem value="senior">Senior</SelectItem>
              </SelectContent>
            </Select>
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
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="male">Male</SelectItem>
                <SelectItem value="female">Female</SelectItem>
                <SelectItem value="non_binary">Non-binary</SelectItem>
                <SelectItem value="other">Other</SelectItem>
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
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select build" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="slim">Slim</SelectItem>
                <SelectItem value="athletic">Athletic</SelectItem>
                <SelectItem value="average">Average</SelectItem>
                <SelectItem value="heavy">Heavy</SelectItem>
                <SelectItem value="muscular">Muscular</SelectItem>
              </SelectContent>
            </Select>
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
              <Input placeholder="e.g., East Asian" {...field} />
            </FormControl>
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
              <Input placeholder="e.g., 5'10\" or 180cm" {...field} />
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
              <Input placeholder="e.g., Black" {...field} />
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
              <Input placeholder="e.g., Long, straight" {...field} />
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
              <Input placeholder="e.g., Brown" {...field} />
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
              <Input placeholder="e.g., Light" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Facial Hair */}
      <FormField
        control={form.control}
        name="physicalAttributes.facialHair"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Facial Hair</FormLabel>
            <FormControl>
              <Input placeholder="e.g., Beard, mustache" {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Distinctive Features - TODO: Implement array input */}
      <div className="col-span-2">
        <FormLabel>Distinctive Features</FormLabel>
        <Input placeholder="e.g., Scar above left eyebrow (comma-separated)" />
        <p className="text-xs text-muted-foreground mt-1">
          Separate multiple features with commas
        </p>
      </div>
    </div>
  );
}
```

### Personality Section

**File**: `packages/features/assets/src/components/CharacterPersonality.tsx`

```typescript
'use client';

import { UseFormReturn } from 'react-hook-form';
import { FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import { Textarea } from '@kit/ui/textarea';
import { CharacterFormData } from '../schemas/character-form.schema';

interface CharacterPersonalityProps {
  form: UseFormReturn<CharacterFormData>;
}

export function CharacterPersonality({ form }: CharacterPersonalityProps) {
  return (
    <div className="space-y-4">
      {/* Traits */}
      <div>
        <FormLabel>Traits</FormLabel>
        <Input placeholder="e.g., brave, intelligent, cautious (comma-separated)" />
        <FormDescription>
          Key personality traits that define this character
        </FormDescription>
      </div>

      {/* Mannerisms */}
      <div>
        <FormLabel>Mannerisms</FormLabel>
        <Input placeholder="e.g., taps pen when nervous (comma-separated)" />
        <FormDescription>
          Distinctive behaviors or habits
        </FormDescription>
      </div>

      {/* Motivations */}
      <FormField
        control={form.control}
        name="personality.motivations"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Motivations</FormLabel>
            <FormControl>
              <Textarea
                placeholder="What drives this character?"
                rows={2}
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Fears */}
      <FormField
        control={form.control}
        name="personality.fears"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Fears</FormLabel>
            <FormControl>
              <Textarea
                placeholder="What does this character fear?"
                rows={2}
                {...field}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Strengths */}
      <div>
        <FormLabel>Strengths</FormLabel>
        <Input placeholder="e.g., analytical thinking, physical prowess (comma-separated)" />
        <FormDescription>
          Character's strengths and abilities
        </FormDescription>
      </div>

      {/* Weaknesses */}
      <div>
        <FormLabel>Weaknesses</FormLabel>
        <Input placeholder="e.g., trust issues, overconfident (comma-separated)" />
        <FormDescription>
          Character's flaws and vulnerabilities
        </FormDescription>
      </div>
    </div>
  );
}
```

### Clothing Section

**File**: `packages/features/assets/src/components/CharacterClothing.tsx`

```typescript
'use client';

import { UseFormReturn } from 'react-hook-form';
import { FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import { Textarea } from '@kit/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@kit/ui/select';
import { CharacterFormData } from '../schemas/character-form.schema';

interface CharacterClothingProps {
  form: UseFormReturn<CharacterFormData>;
}

export function CharacterClothing({ form }: CharacterClothingProps) {
  return (
    <div className="space-y-4">
      {/* Default Outfit */}
      <FormField
        control={form.control}
        name="clothing.defaultOutfit"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Default Outfit</FormLabel>
            <FormControl>
              <Textarea
                placeholder="Describe the character's typical clothing"
                rows={3}
                {...field}
              />
            </FormControl>
            <FormDescription>
              This will be used as the default clothing in generated scenes
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Style */}
      <FormField
        control={form.control}
        name="clothing.style"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Style</FormLabel>
            <Select onValueChange={field.onChange} value={field.value}>
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder="Select style" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="casual">Casual</SelectItem>
                <SelectItem value="formal">Formal</SelectItem>
                <SelectItem value="sporty">Sporty</SelectItem>
                <SelectItem value="vintage">Vintage</SelectItem>
                <SelectItem value="fantasy">Fantasy</SelectItem>
                <SelectItem value="modern">Modern</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Colors */}
      <div>
        <FormLabel>Preferred Colors</FormLabel>
        <Input placeholder="e.g., navy, gray, white (comma-separated)" />
        <FormDescription>
          Colors commonly worn by this character
        </FormDescription>
      </div>

      {/* Accessories */}
      <div>
        <FormLabel>Accessories</FormLabel>
        <Input placeholder="e.g., watch, glasses, necklace (comma-separated)" />
        <FormDescription>
          Items the character regularly wears or carries
        </FormDescription>
      </div>
    </div>
  );
}
```

### Backstory Section

**File**: `packages/features/assets/src/components/CharacterBackstory.tsx`

```typescript
'use client';

import { UseFormReturn } from 'react-hook-form';
import { FormField, FormItem, FormLabel, FormControl, FormMessage, FormDescription } from '@kit/ui/form';
import { Textarea } from '@kit/ui/textarea';
import { CharacterFormData } from '../schemas/character-form.schema';

interface CharacterBackstoryProps {
  form: UseFormReturn<CharacterFormData>;
}

export function CharacterBackstory({ form }: CharacterBackstoryProps) {
  const backstory = form.watch('backstory');
  const charCount = backstory?.length ?? 0;

  return (
    <FormField
      control={form.control}
      name="backstory"
      render={({ field }) => (
        <FormItem>
          <FormLabel>Backstory</FormLabel>
          <FormControl>
            <Textarea
              placeholder="Write the character's background story..."
              rows={8}
              {...field}
            />
          </FormControl>
          <FormDescription className="flex justify-between">
            <span>The character's history and background</span>
            <span className={charCount > 2000 ? 'text-destructive' : ''}>
              {charCount} / 2000
            </span>
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
```

---

## File Changes

### New Files

1. **packages/features/assets/src/components/CharacterEditor.tsx**
   - Main editor component with form state management

2. **packages/features/assets/src/components/CharacterEditorForm.tsx**
   - Form layout with accordion sections

3. **packages/features/assets/src/components/CharacterBasicInfo.tsx**
   - Name and description fields

4. **packages/features/assets/src/components/CharacterPhysicalAttributes.tsx**
   - Physical attribute fields

5. **packages/features/assets/src/components/CharacterPersonality.tsx**
   - Personality trait fields

6. **packages/features/assets/src/components/CharacterClothing.tsx**
   - Clothing and style fields

7. **packages/features/assets/src/components/CharacterBackstory.tsx**
   - Backstory textarea with character count

8. **packages/features/assets/src/components/CharacterVoiceSelector.tsx**
   - Voice profile selection (implement separately)

9. **packages/features/assets/src/components/CharacterImageUpload.tsx**
   - Image upload integration (implement separately)

10. **packages/features/assets/src/schemas/character-form.schema.ts**
    - Form validation schema

11. **packages/features/assets/src/hooks/use-auto-save.ts**
    - Auto-save hook

12. **packages/features/assets/src/hooks/use-unsaved-changes.ts**
    - Unsaved changes warning hook

### Modified Files

None (new feature)

---

## Acceptance Criteria

### Functional

- [ ] Form displays all character fields organized in sections
- [ ] Basic info section always visible (name, description)
- [ ] Physical attributes in collapsible accordion
- [ ] Personality traits in collapsible accordion
- [ ] Clothing style in collapsible accordion
- [ ] Backstory in collapsible accordion
- [ ] Form validates all fields with Zod schema
- [ ] Field-level errors displayed inline
- [ ] Submit button disabled until valid
- [ ] Create mode: submits to createCharacterAction
- [ ] Edit mode: populates fields and submits to updateCharacterAction
- [ ] Auto-save draft to localStorage every 30 seconds
- [ ] Restore draft on page load
- [ ] Warn before navigation with unsaved changes
- [ ] Loading spinner during submission
- [ ] Success toast on successful save
- [ ] Error toast on failure
- [ ] Image upload integration works
- [ ] Voice profile selection works

### Non-Functional

- [ ] Form submission completes within 3 seconds
- [ ] Responsive on mobile (stacked layout)
- [ ] Responsive on tablet/desktop (2-column layout for attributes)
- [ ] Keyboard navigation works (Tab, Enter, Esc)
- [ ] All fields have ARIA labels
- [ ] Error messages announced to screen readers
- [ ] Focus management correct (errors, submission)
- [ ] TypeScript compiles without errors
- [ ] No ESLint warnings

---

## Test Plan

### Unit Tests

**File**: `packages/features/assets/src/components/__tests__/CharacterEditor.test.tsx`

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CharacterEditor } from '../CharacterEditor';

describe('CharacterEditor', () => {
  it('should render all form sections', () => {
    render(<CharacterEditor projectId="project-1" />);

    expect(screen.getByLabelText('Name *')).toBeInTheDocument();
    expect(screen.getByText('Physical Attributes')).toBeInTheDocument();
    expect(screen.getByText('Personality')).toBeInTheDocument();
    expect(screen.getByText('Clothing & Style')).toBeInTheDocument();
    expect(screen.getByText('Backstory')).toBeInTheDocument();
  });

  it('should validate required fields', async () => {
    render(<CharacterEditor projectId="project-1" />);
    const user = userEvent.setup();

    const submitButton = screen.getByText('Create Character');
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByText('Name is required')).toBeInTheDocument();
    });
  });

  it('should submit form with valid data', async () => {
    render(<CharacterEditor projectId="project-1" />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Name *'), 'John Doe');
    await user.click(screen.getByText('Create Character'));

    await waitFor(() => {
      expect(screen.getByText('Character created successfully')).toBeInTheDocument();
    });
  });

  it('should populate form in edit mode', async () => {
    const characterData = {
      id: 'char-1',
      name: 'Existing Character',
      description: 'A test character',
    };

    render(<CharacterEditor projectId="project-1" characterId="char-1" />);

    await waitFor(() => {
      expect(screen.getByDisplayValue('Existing Character')).toBeInTheDocument();
    });
  });

  it('should auto-save draft', async () => {
    vi.useFakeTimers();

    render(<CharacterEditor projectId="project-1" />);
    const user = userEvent.setup();

    await user.type(screen.getByLabelText('Name *'), 'Draft Character');

    vi.advanceTimersByTime(30000); // 30 seconds

    const draft = localStorage.getItem('character-draft');
    expect(draft).toContain('Draft Character');

    vi.useRealTimers();
  });
});
```

---

## References

- **FILM-202**: Character actions
- **FILM-204**: AssetGallery component
- **FILM-206**: VoiceProfileEditor component
- **FILM-207**: ImageUploader component
- **React Hook Form**: https://react-hook-form.com/
- **Zod**: https://zod.dev/
- **Constitution**: Section 2.3 (Component Pattern)
