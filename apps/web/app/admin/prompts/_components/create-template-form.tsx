'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import { Textarea } from '@kit/ui/textarea';
import { Button } from '@kit/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';
import { Loader2Icon, InfoIcon } from 'lucide-react';
import { CreatePromptTemplateSchema } from '@kit/prompt-templates/schemas';
import type { z } from 'zod';

type CreateTemplateFormData = z.infer<typeof CreatePromptTemplateSchema>;

interface CreateTemplateFormProps {
  onSubmit: (data: CreateTemplateFormData) => Promise<void>;
  onSuccess?: () => void;
}

const categories = [
  { value: 'analysis', label: 'Analysis' },
  { value: 'classification', label: 'Classification' },
  { value: 'conversation', label: 'Conversation' },
  { value: 'extraction', label: 'Extraction' },
  { value: 'generation', label: 'Generation' },
  { value: 'summarization', label: 'Summarization' },
  { value: 'transformation', label: 'Transformation' },
  { value: 'validation', label: 'Validation' },
  { value: 'orchestration', label: 'Orchestration' },
] as const;

const environments = [
  { value: 'development', label: 'Development' },
  { value: 'staging', label: 'Staging' },
  { value: 'canary', label: 'Canary' },
  { value: 'production', label: 'Production' },
] as const;

const compositionStrategies = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'conditional', label: 'Conditional' },
  { value: 'ab_test', label: 'A/B Test' },
  { value: 'bandit', label: 'Multi-Armed Bandit' },
  { value: 'optimized', label: 'Optimized' },
] as const;

export function CreateTemplateForm({
  onSubmit,
  onSuccess,
}: CreateTemplateFormProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const form = useForm({
    resolver: zodResolver(CreatePromptTemplateSchema),
    defaultValues: {
      slug: '',
      name: '',
      description: '',
      category: 'conversation' as const,
      template_content: '',
      variables: {},
      output_schema: {},
      composition_strategy: 'fixed' as const,
      tags: [],
      metadata: {},
    },
  });

  const handleSubmit = (data: CreateTemplateFormData) => {
    startTransition(async () => {
      try {
        await onSubmit(data);
        toast.success('Template created successfully');
        router.push('/admin/prompts');
        router.refresh();
        onSuccess?.();
      } catch (error) {
        // Check for duplicate slug error
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes('duplicate') || errorMessage.includes('unique constraint')) {
          toast.error('A template with this slug already exists. Please choose a different slug.');
          form.setError('slug', {
            type: 'manual',
            message: 'This slug is already in use',
          });
        } else {
          toast.error('Failed to create template');
        }
        console.error(error);
      }
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        <div className="grid gap-6 md:grid-cols-2">
          <FormField
            control={form.control}
            name="slug"
            render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Slug <InfoIcon className="ml-1 inline h-3 w-3" />
                </FormLabel>
                <FormControl>
                  <Input
                    placeholder="analyze-support-ticket"
                    {...field}
                    className="font-mono text-sm"
                  />
                </FormControl>
                <FormDescription>
                  Unique identifier used in code (lowercase, hyphens only)
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="name"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Name</FormLabel>
                <FormControl>
                  <Input placeholder="Support Ticket Analysis" {...field} />
                </FormControl>
                <FormDescription>
                  Human-readable template name
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Analyzes customer support tickets to extract key information..."
                  rows={2}
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Brief description of this template&apos;s purpose
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-6 md:grid-cols-2">
          <FormField
            control={form.control}
            name="category"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Category</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a category" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        {cat.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  Primary function of this prompt
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="composition_strategy"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Composition Strategy</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select strategy" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {compositionStrategies.map((strategy) => (
                      <SelectItem key={strategy.value} value={strategy.value}>
                        {strategy.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  How system prompts are composed
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="template_content"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Template Content</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Analyze the following support ticket and extract key information:&#10;&#10;Ticket: {{ticket_content}}&#10;&#10;Extract: issue type, priority, sentiment"
                  rows={10}
                  className="font-mono text-sm"
                  {...field}
                />
              </FormControl>
              <FormDescription>
                The prompt template. Use {'{'}
                {'{'}variable_name{'}'}{'}'}for variables.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
            Create Template
          </Button>
        </div>
      </form>
    </Form>
  );
}
