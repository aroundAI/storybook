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
import { toast } from '@kit/ui/sonner';
import { Loader2Icon } from 'lucide-react';
import { UpdateSystemPromptSchema } from '@kit/prompt-templates/schemas';
import type { z } from 'zod';

type UpdateSystemPromptFormData = z.infer<typeof UpdateSystemPromptSchema>;

interface EditSystemPromptFormProps {
  systemPrompt: {
    id: string;
    name: string;
    description: string | null;
    content: string;
    priority: number;
    is_active: boolean;
    tags: string[];
  };
  onSubmit: (data: UpdateSystemPromptFormData) => Promise<void>;
  onSuccess?: () => void;
}

export function EditSystemPromptForm({
  systemPrompt,
  onSubmit,
  onSuccess,
}: EditSystemPromptFormProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const form = useForm({
    resolver: zodResolver(UpdateSystemPromptSchema),
    defaultValues: {
      id: systemPrompt.id,
      name: systemPrompt.name,
      description: systemPrompt.description || '',
      content: systemPrompt.content,
      priority: systemPrompt.priority,
      is_active: systemPrompt.is_active,
      tags: systemPrompt.tags,
    },
  });

  const handleSubmit = (data: UpdateSystemPromptFormData) => {
    startTransition(async () => {
      try {
        await onSubmit(data);
        toast.success('System prompt updated successfully');
        router.push('/admin/prompts');
        router.refresh();
        onSuccess?.();
      } catch (error) {
        toast.error('Failed to update system prompt');
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
                <Input placeholder="GDPR Compliance" {...field} />
              </FormControl>
              <FormDescription>Human-readable system prompt name</FormDescription>
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

        <FormField
          control={form.control}
          name="content"
          render={({ field }) => (
            <FormItem>
              <FormLabel>System Prompt Content</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="You are a helpful assistant..."
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

        <FormField
          control={form.control}
          name="is_active"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <FormLabel className="text-base">Active Status</FormLabel>
                <FormDescription>
                  Inactive system prompts will not be included in composition
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
            Update System Prompt
          </Button>
        </div>
      </form>
    </Form>
  );
}
