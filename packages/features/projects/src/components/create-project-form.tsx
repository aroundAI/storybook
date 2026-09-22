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

import { CreateProjectSchema } from '../lib/schemas/project.schema';
import { createProjectAction } from '../lib/server/project.mutations';

interface CreateProjectFormProps {
  accountId: string;
  onSuccess?: () => void;
}

export function CreateProjectForm({
  accountId,
  onSuccess,
}: CreateProjectFormProps) {
  const [isPending, startTransition] = useTransition();

  const form = useForm({
    resolver: zodResolver(CreateProjectSchema),
    defaultValues: {
      account_id: accountId,
      name: '',
      description: '',
      slug: '',
    },
  });

  const onSubmit = form.handleSubmit((data) => {
    startTransition(async () => {
      try {
        const result = await unwrap(createProjectAction(data));

        if (result.success) {
          toast.success(<Trans i18nKey="projects:createSuccess" />);
          form.reset();
          onSuccess?.();
        }
      } catch (error) {
        toast.error(
          <Trans
            i18nKey="projects:createError"
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
            data-test="create-project-submit"
          >
            {isPending ? (
              <Trans i18nKey="common:creating" />
            ) : (
              <Trans i18nKey="projects:createProject" />
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
}
