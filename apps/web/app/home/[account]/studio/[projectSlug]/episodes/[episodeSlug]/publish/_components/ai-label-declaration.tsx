'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { aiLabelUnsupportedNote } from '@kit/publishing/lib/ai-label';
import { AiLabelDeclarationSchema } from '@kit/publishing/lib/schemas/publish';
import { Checkbox } from '@kit/ui/checkbox';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@kit/ui/form';

interface AiLabelDeclarationProps {
  aiGenerated: boolean;
  onChange: (aiGenerated: boolean) => void;
  /** The platforms of the connected channels this publish can go to */
  platforms: readonly string[];
}

/**
 * FILM-1731 (owner, 2026-10-02: "add an option to mark it as AI Labeled").
 * One declaration for the whole publish, off until the creator turns it on;
 * each platform with a field for it receives it, and the note names the
 * connected ones that have none.
 */
export function AiLabelDeclaration({
  aiGenerated,
  onChange,
  platforms,
}: AiLabelDeclarationProps) {
  const form = useForm({
    resolver: zodResolver(AiLabelDeclarationSchema),
    defaultValues: { aiGenerated },
  });
  const unsupported = aiLabelUnsupportedNote(platforms);

  return (
    <Form {...form}>
      <div className="space-y-2" data-test="ai-label-declaration">
        <FormField
          control={form.control}
          name="aiGenerated"
          render={({ field }) => (
            <FormItem className="flex items-start gap-2 space-y-0">
              <FormControl>
                <Checkbox
                  data-test="ai-label-option"
                  checked={field.value}
                  onCheckedChange={(checked) => {
                    const declared = checked === true;
                    field.onChange(declared);
                    onChange(declared);
                  }}
                />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>AI-generated (label it)</FormLabel>
                <FormDescription className="text-xs">
                  Each platform that supports it shows its AI label on this
                  video.
                </FormDescription>
              </div>
            </FormItem>
          )}
        />
        {unsupported && (
          <p
            className="text-xs text-amber-700 dark:text-amber-400"
            data-test="ai-label-unsupported"
          >
            {unsupported}
          </p>
        )}
      </div>
    </Form>
  );
}
