'use client';

import { useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2Icon } from 'lucide-react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';

import { UpdateVariantSchema } from '@kit/prompt-templates/schemas';
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

type UpdateVariantFormData = z.infer<typeof UpdateVariantSchema>;

interface EditVariantFormProps {
  variant: {
    id: string;
    variant_name: string;
    description: string | null;
    template_content: string | null;
    traffic_weight: number;
    is_active: boolean;
  };
  templateId: string;
  onSubmit: (data: UpdateVariantFormData) => Promise<void>;
  onSuccess?: () => void;
}

export function EditVariantForm({
  variant,
  templateId,
  onSubmit,
  onSuccess,
}: EditVariantFormProps) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const form = useForm({
    resolver: zodResolver(UpdateVariantSchema),
    defaultValues: {
      id: variant.id,
      variant_name: variant.variant_name,
      description: variant.description || '',
      template_content: variant.template_content || '',
      traffic_weight: Number(variant.traffic_weight),
      is_active: variant.is_active,
    },
  });

  const handleSubmit = (data: UpdateVariantFormData) => {
    startTransition(async () => {
      try {
        await onSubmit(data);
        toast.success('Variant updated successfully');
        router.push(`/admin/prompts/${templateId}/variants`);
        router.refresh();
        onSuccess?.();
      } catch (error) {
        toast.error('Failed to update variant');
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

        <FormField
          control={form.control}
          name="is_active"
          render={({ field }) => (
            <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
              <div className="space-y-0.5">
                <FormLabel className="text-base">Active Status</FormLabel>
                <FormDescription>
                  Inactive variants will not be used in traffic distribution
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
            Update Variant
          </Button>
        </div>
      </form>
    </Form>
  );
}
