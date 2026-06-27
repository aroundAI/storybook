'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

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

const ProjectIntroSchema = z.object({
  title: z.string().min(1, 'Title is required'),
});

export function Default() {
  const form = useForm({
    resolver: zodResolver(ProjectIntroSchema),
    defaultValues: { title: 'The Last Lighthouse' },
  });

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
              <FormDescription>
                Shown across the studio and on published episodes
              </FormDescription>
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
