'use client';

import { useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { UpdateSystemPromptSchema } from '@kit/prompt-templates/schemas';
import { Button } from '@kit/ui/button';
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
import { toast } from '@kit/ui/sonner';
import { Switch } from '@kit/ui/switch';
import { Textarea } from '@kit/ui/textarea';

type UpdateSystemPromptFormData = z.infer<typeof UpdateSystemPromptSchema>;

interface EditSystemPromptFormProps {
  systemPrompt: {
    id: string;
    name: string;
    description: string | null;
    content: string;
    is_active: boolean;
    tags: string[];
  };
  onSubmit: (data: UpdateSystemPromptFormData) => Promise<void>;
  onSuccess?: () => void;
  formId?: string;
}

export function EditSystemPromptForm({
  systemPrompt,
  onSubmit,
  onSuccess,
  formId = 'edit-system-prompt-form',
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
    <>
      <div className="pb-24">
        <Form {...form}>
          <form
            id={formId}
            onSubmit={form.handleSubmit(handleSubmit)}
            className="space-y-6"
          >
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
              name="is_active"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">Active Status</FormLabel>
                    <FormDescription>
                      Inactive system prompts will not be included in
                      composition
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
          </form>
        </Form>
      </div>

      {/* Sticky Footer with Action Buttons */}
      <div className="bg-background fixed bottom-0 left-0 right-0 border-t">
        <div className="container mx-auto flex justify-end gap-3 px-6 py-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            disabled={isPending}
            size="lg"
          >
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={isPending} size="lg">
            {isPending && <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />}
            Update System Prompt
          </Button>
        </div>
      </div>
    </>
  );
}
