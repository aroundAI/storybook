'use client';

import { useEffect } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@kit/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { Input } from '@kit/ui/input';

const ProjectIntroSchema = z.object({
  title: z.string().min(1, 'Title is required'),
});

// Pre-populated with a validation error so FormMessage actually renders
// visible error text in a static screenshot (it returns null when there's
// nothing to show). Validation is triggered on mount via useEffect so the
// error is committed to a render before the screenshot is taken.
export function Default() {
  const form = useForm({
    resolver: zodResolver(ProjectIntroSchema),
    defaultValues: { title: '' },
    mode: 'onChange',
  });

  useEffect(() => {
    void form.trigger('title');
  }, [form]);

  return (
    <Form {...form}>
      <form className="flex w-80 flex-col gap-y-4">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Project title</FormLabel>
              <FormControl>
                <Input placeholder="Enter project title" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="self-end">
          Save Changes
        </Button>
      </form>
    </Form>
  );
}
