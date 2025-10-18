'use client';

import { useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { CreateVariantSchema } from '@kit/prompt-templates/schemas';
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
import { Textarea } from '@kit/ui/textarea';

type CreateVariantFormData = z.infer<typeof CreateVariantSchema>;

interface CreateVariantFormProps {
  templateId: string;
  onSubmit: (data: CreateVariantFormData) => Promise<void>;
  onSuccess?: () => void;
}

export function CreateVariantForm({
  templateId,
  onSubmit,
  onSuccess,
}: CreateVariantFormProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const form = useForm({
    resolver: zodResolver(CreateVariantSchema),
    defaultValues: {
      template_id: templateId,
      variant_name: '',
      description: '',
      template_content: '',
      traffic_weight: 50,
    },
  });

  const handleSubmit = (data: CreateVariantFormData) => {
    startTransition(async () => {
      try {
        await onSubmit(data);
        toast.success('Variant created successfully');
        router.push(`/admin/prompts/${templateId}/variants`);
        router.refresh();
        onSuccess?.();
      } catch (error) {
        toast.error('Failed to create variant');
        console.error(error);
      }
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        <FormField
          control={form.control}
          name="variant_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Variant Name</FormLabel>
              <FormControl>
                <Input
                  placeholder="e.g., Formal Tone, Detailed Version, Short Form"
                  {...field}
                />
              </FormControl>
              <FormDescription>
                A descriptive name for this variant
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
                  placeholder="Describe what makes this variant unique..."
                  rows={3}
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Optional description of this variant&apos;s purpose or use case
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
              <FormLabel>Custom Template Content (Optional)</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Leave empty to use the default template content..."
                  rows={8}
                  className="font-mono text-sm"
                  {...field}
                />
              </FormControl>
              <FormDescription>
                Override the default template content for this variant. Leave
                empty to use the original template.
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="traffic_weight"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Traffic Weight</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  {...field}
                  onChange={(e) => field.onChange(parseFloat(e.target.value))}
                />
              </FormControl>
              <FormDescription>
                Weight for traffic distribution (0-100). Higher weights receive
                more traffic in A/B testing.
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
            Create Variant
          </Button>
        </div>
      </form>
    </Form>
  );
}
