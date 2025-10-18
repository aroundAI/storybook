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
import { CreateSystemPromptSchema } from '@kit/prompt-templates/schemas';
import type { z } from 'zod';

type CreateSystemPromptFormData = z.infer<typeof CreateSystemPromptSchema>;

interface CreateSystemPromptFormProps {
  onSubmit: (data: CreateSystemPromptFormData) => Promise<void>;
  onSuccess?: () => void;
}

const layerTypes = [
  { value: 'compliance', label: 'Compliance', description: 'Legal/regulatory requirements' },
  { value: 'role', label: 'Role', description: 'Define AI persona/expertise' },
  { value: 'context', label: 'Context', description: 'Background information' },
  { value: 'brand_voice', label: 'Brand Voice', description: 'Tone and style guidelines' },
  { value: 'format', label: 'Format', description: 'Output structure requirements' },
  { value: 'standards', label: 'Standards', description: 'Quality and consistency rules' },
  { value: 'constraints', label: 'Constraints', description: 'Limitations and boundaries' },
  { value: 'examples', label: 'Examples', description: 'Reference examples' },
] as const;

const scopes = [
  { value: 'global', label: 'Global', description: 'Applies to all templates' },
  { value: 'category', label: 'Category', description: 'Applies to specific category' },
  { value: 'template', label: 'Template', description: 'Applies to specific template' },
] as const;

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

export function CreateSystemPromptForm({
  onSubmit,
  onSuccess,
}: CreateSystemPromptFormProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const form = useForm({
    resolver: zodResolver(CreateSystemPromptSchema),
    defaultValues: {
      slug: '',
      name: '',
      description: '',
      layer_type: 'role' as const,
      scope: 'global' as const,
      content: '',
      priority: 0,
      tags: [],
      metadata: {},
    },
  });

  const scope = form.watch('scope');

  const handleSubmit = (data: CreateSystemPromptFormData) => {
    startTransition(async () => {
      try {
        await onSubmit(data);
        toast.success('System prompt created successfully');
        router.push('/admin/prompts');
        router.refresh();
        onSuccess?.();
      } catch (error) {
        // Check for duplicate slug error
        const errorMessage = error instanceof Error ? error.message : String(error);

        if (errorMessage.includes('duplicate') || errorMessage.includes('unique constraint')) {
          toast.error('A system prompt with this slug already exists. Please choose a different slug.');
          form.setError('slug', {
            type: 'manual',
            message: 'This slug is already in use',
          });
        } else {
          toast.error('Failed to create system prompt');
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
                    placeholder="compliance-gdpr"
                    {...field}
                    className="font-mono text-sm"
                  />
                </FormControl>
                <FormDescription>
                  Unique identifier (lowercase, hyphens only)
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
                  <Input placeholder="GDPR Compliance" {...field} />
                </FormControl>
                <FormDescription>
                  Human-readable system prompt name
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
                  placeholder="Ensures all responses comply with GDPR requirements..."
                  rows={2}
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Brief description of this system prompt&apos;s purpose
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="grid gap-6 md:grid-cols-2">
          <FormField
            control={form.control}
            name="layer_type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Layer Type</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select layer type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {layerTypes.map((type) => (
                      <SelectItem key={type.value} value={type.value}>
                        <div className="flex flex-col">
                          <span className="font-medium">{type.label}</span>
                          <span className="text-muted-foreground text-xs">
                            {type.description}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>
                  The type of system prompt layer
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="scope"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Scope</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select scope" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {scopes.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        <div className="flex flex-col">
                          <span className="font-medium">{s.label}</span>
                          <span className="text-muted-foreground text-xs">
                            {s.description}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormDescription>Where this prompt applies</FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {scope === 'category' && (
          <FormField
            control={form.control}
            name="target_category"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Target Category</FormLabel>
                <Select
                  onValueChange={field.onChange}
                  defaultValue={field.value}
                >
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select category" />
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
                  The category this system prompt applies to
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        )}

        <FormField
          control={form.control}
          name="content"
          render={({ field }) => (
            <FormItem>
              <FormLabel>System Prompt Content</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="You are a helpful assistant that always complies with GDPR...&#10;&#10;When handling personal data:&#10;- Always get explicit consent&#10;- Provide data deletion options&#10;- Ensure transparency"
                  rows={10}
                  className="font-mono text-sm"
                  {...field}
                />
              </FormControl>
              <FormDescription>
                The actual system prompt text that will be prepended
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="priority"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Priority</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min="0"
                  {...field}
                  onChange={(e) => field.onChange(parseInt(e.target.value))}
                />
              </FormControl>
              <FormDescription>
                Higher priority prompts are composed first (0 = lowest)
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
            Create System Prompt
          </Button>
        </div>
      </form>
    </Form>
  );
}
