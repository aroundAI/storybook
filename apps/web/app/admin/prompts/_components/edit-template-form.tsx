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
import { Switch } from '@kit/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';
import { Loader2Icon } from 'lucide-react';
import { UpdatePromptTemplateSchema } from '@kit/prompt-templates/schemas';
import type { z } from 'zod';

type UpdateTemplateFormData = z.infer<typeof UpdatePromptTemplateSchema>;

interface EditTemplateFormProps {
  template: {
    id: string;
    name: string;
    description: string | null;
    template_content: string;
    composition_strategy: string;
    is_active: boolean;
    tags: string[];
  };
  onSubmit: (data: UpdateTemplateFormData) => Promise<void>;
  onSuccess?: () => void;
}

const compositionStrategies = [
  { value: 'fixed', label: 'Fixed' },
  { value: 'conditional', label: 'Conditional' },
  { value: 'ab_test', label: 'A/B Test' },
  { value: 'bandit', label: 'Multi-Armed Bandit' },
  { value: 'optimized', label: 'Optimized' },
] as const;

export function EditTemplateForm({
  template,
  onSubmit,
  onSuccess,
}: EditTemplateFormProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const form = useForm({
    resolver: zodResolver(UpdatePromptTemplateSchema),
    defaultValues: {
      id: template.id,
      name: template.name,
      description: template.description || '',
      template_content: template.template_content,
      composition_strategy: template.composition_strategy as any,
      is_active: template.is_active,
      tags: template.tags,
    },
  });

  const handleSubmit = (data: UpdateTemplateFormData) => {
    startTransition(async () => {
      try {
        await onSubmit(data);
        toast.success('Template updated successfully');
        router.push('/admin/prompts');
        router.refresh();
        onSuccess?.();
      } catch (error) {
        toast.error('Failed to update template');
        console.error(error);
      }
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input placeholder="Support Ticket Analysis" {...field} />
              </FormControl>
              <FormDescription>Human-readable template name</FormDescription>
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
                  placeholder="Analyzes customer support tickets..."
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

        <FormField
          control={form.control}
          name="template_content"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Template Content</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Enter your prompt template..."
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

        <FormField
          control={form.control}
          name="composition_strategy"
          render={({ field}) => (
            <FormItem>
              <FormLabel>Composition Strategy</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
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

        <FormField
          control={form.control}
          name="is_active"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <FormLabel className="text-base">Active Status</FormLabel>
                <FormDescription>
                  Inactive templates will not be available for use
                </FormDescription>
              </div>
              <FormControl>
                <Switch
                  checked={field.value}
                  onCheckedChange={field.onChange}
                />
              </FormControl>
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
            Update Template
          </Button>
        </div>
      </form>
    </Form>
  );
}
