'use client';

import { useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertTriangle,
  ExternalLink,
  Eye,
  Globe,
  Link as LinkIcon,
  Lock,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { refusalMessage, unwrap } from '@kit/next/action-result';
import { updateProjectVisibilityAction } from '@kit/public-sharing/server/visibility-actions';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';

const visibilitySchema = z.object({
  visibility: z.enum(['private', 'public', 'unlisted']),
  public_slug: z
    .string()
    .regex(
      /^[a-z0-9-]+$/,
      'Only lowercase letters, numbers, and hyphens allowed',
    )
    .min(3)
    .max(50)
    .optional()
    .or(z.literal('')),
});

type VisibilityFormValues = z.infer<typeof visibilitySchema>;

interface ProjectVisibilitySettingsProps {
  projectId: string;
  projectName: string;
  accountSlug: string;
  currentVisibility: string;
  currentPublicSlug: string | null;
  isAccountPublic?: boolean;
}

const VISIBILITY_OPTIONS = [
  {
    value: 'private',
    label: 'Private',
    description: 'Only visible to team members',
    icon: Lock,
  },
  {
    value: 'public',
    label: 'Public',
    description: 'Visible to everyone and searchable',
    icon: Globe,
  },
  {
    value: 'unlisted',
    label: 'Unlisted',
    description: 'Accessible via direct link only',
    icon: LinkIcon,
  },
];

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}

export function ProjectVisibilitySettings({
  projectId,
  projectName,
  accountSlug,
  currentVisibility,
  currentPublicSlug,
  isAccountPublic = true,
}: ProjectVisibilitySettingsProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const form = useForm<VisibilityFormValues>({
    resolver: zodResolver(visibilitySchema),
    defaultValues: {
      visibility:
        (currentVisibility as 'private' | 'public' | 'unlisted') || 'private',
      public_slug: currentPublicSlug || generateSlug(projectName),
    },
  });

  const visibility = form.watch('visibility');
  const publicSlug = form.watch('public_slug');
  const showSlugField = visibility === 'public' || visibility === 'unlisted';

  const onSubmit = (values: VisibilityFormValues) => {
    startTransition(async () => {
      try {
        await unwrap(
          updateProjectVisibilityAction({
            projectId,
            visibility: values.visibility,
            publicSlug: values.public_slug || 'default',
          }),
        );
        toast.success('Visibility settings updated');
        router.refresh();
      } catch (error) {
        toast.error(
          refusalMessage(error, 'Failed to update visibility settings'),
        );
      }
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Eye className="h-5 w-5" />
          Public Sharing
        </CardTitle>
        <CardDescription>Control who can access this project</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            <FormField
              control={form.control}
              name="visibility"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Visibility</FormLabel>
                  <Select
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select visibility" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {VISIBILITY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          <div className="flex items-center gap-2">
                            <option.icon className="h-4 w-4" />
                            <div>
                              <div>{option.label}</div>
                              <div className="text-xs text-muted-foreground">
                                {option.description}
                              </div>
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {showSlugField && (
              <>
                <FormField
                  control={form.control}
                  name="public_slug"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Public URL Slug</FormLabel>
                      <FormControl>
                        <Input placeholder="my-project" {...field} />
                      </FormControl>
                      <FormDescription className="flex items-center gap-2">
                        <span>Your project will be available at:</span>
                        <a
                          href={`/@${accountSlug}/${publicSlug || 'your-slug'}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs text-primary transition-colors hover:bg-muted/80 hover:underline"
                        >
                          /@{accountSlug}/{publicSlug || 'your-slug'}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {visibility === 'public' && !isAccountPublic && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-700 dark:bg-amber-900/20">
                    <p className="flex items-center gap-2 font-medium text-amber-800 dark:text-amber-200">
                      <AlertTriangle className="h-4 w-4" />
                      Public profile not enabled
                    </p>
                    <p className="mt-1 text-amber-700 dark:text-amber-300">
                      Your company&apos;s public profile must be enabled before
                      public projects are visible.
                    </p>
                    <a
                      href={`/home/${accountSlug}/settings/public-profile`}
                      className="mt-2 inline-flex items-center gap-1 font-medium text-amber-800 hover:underline dark:text-amber-200"
                    >
                      Enable public profile
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}

                {visibility === 'public' && isAccountPublic && (
                  <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm dark:border-green-800 dark:bg-green-900/20">
                    <p className="font-medium text-green-800 dark:text-green-200">
                      🌍 This project will be publicly visible
                    </p>
                    <p className="mt-1 text-green-700 dark:text-green-300">
                      It will appear on your public company page and be indexed
                      by search engines.
                    </p>
                  </div>
                )}

                {visibility === 'unlisted' && (
                  <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-4 text-sm dark:border-yellow-800 dark:bg-yellow-900/20">
                    <p className="font-medium text-yellow-800 dark:text-yellow-200">
                      🔗 This project is link-only
                    </p>
                    <p className="mt-1 text-yellow-700 dark:text-yellow-300">
                      Only people with the direct link can view it. It
                      won&apos;t appear in listings.
                    </p>
                  </div>
                )}
              </>
            )}

            <div className="flex justify-end">
              <Button type="submit" disabled={isPending}>
                {isPending ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
