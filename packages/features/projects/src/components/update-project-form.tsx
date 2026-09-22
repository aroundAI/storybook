'use client';

import { useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';

import { refusalMessage, unwrap } from '@kit/next/action-result';
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
import { Trans } from '@kit/ui/trans';

import { UpdateProjectSchema } from '../lib/schemas/project.schema';
import { updateProjectAction } from '../lib/server/project.mutations';
import type { Project } from '../lib/types';

interface UpdateProjectFormProps {
  project: Project;
  onSuccess?: () => void;
}

export function UpdateProjectForm({
  project,
  onSuccess,
}: UpdateProjectFormProps) {
  const [isPending, startTransition] = useTransition();

  const form = useForm({
    resolver: zodResolver(UpdateProjectSchema),
    defaultValues: {
      id: project.id,
      name: project.name || '',
      description: project.description || '',
      slug: project.slug || '',
    },
  });

  const onSubmit = form.handleSubmit((data) => {
    startTransition(async () => {
      try {
        const result = await unwrap(updateProjectAction(data));

        if (result.success) {
          toast.success(<Trans i18nKey="projects:updateSuccess" />);
          onSuccess?.();
        }
      } catch (error) {
        toast.error(
          <Trans
            i18nKey="projects:updateError"
            values={{
              error: refusalMessage(error, 'Unknown error'),
            }}
          />,
        );
      }
    });
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-6">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                <Trans i18nKey="projects:nameLabel" />
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="My Awesome Project"
                  disabled={isPending}
                  data-test="project-name-input"
                />
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
              <FormLabel>
                <Trans i18nKey="projects:descriptionLabel" />
              </FormLabel>
              <FormControl>
                <Textarea
                  {...field}
                  value={field.value || ''}
                  placeholder="A brief description of your project..."
                  disabled={isPending}
                  rows={4}
                  data-test="project-description-input"
                />
              </FormControl>
              <FormDescription>
                <Trans i18nKey="projects:descriptionHelp" />
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="slug"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                <Trans i18nKey="projects:slugLabel" />
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder="my-project"
                  disabled={isPending}
                  data-test="project-slug-input"
                />
              </FormControl>
              <FormDescription>
                <Trans i18nKey="projects:slugHelp" />
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />

        <div className="flex justify-end gap-2">
          <Button
            type="submit"
            disabled={isPending}
            data-test="update-project-submit"
          >
            {isPending ? (
              <Trans i18nKey="common:updating" />
            ) : (
              <Trans i18nKey="common:save" />
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
