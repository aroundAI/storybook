'use client';

import { useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { refusalMessage, unwrap } from '@kit/next/action-result';
import { updatePublicProfileAction } from '@kit/public-sharing/server/visibility-actions';
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
import { toast } from '@kit/ui/sonner';
import { Switch } from '@kit/ui/switch';
import { Textarea } from '@kit/ui/textarea';

const publicProfileSchema = z.object({
  is_public: z.boolean(),
  display_name: z.string().max(100).optional(),
  bio: z.string().max(300).optional(),
  website_url: z.string().url().optional().or(z.literal('')),
  social_links: z
    .object({
      youtube: z.string().optional(),
      twitter: z.string().optional(),
      instagram: z.string().optional(),
    })
    .optional(),
  custom_styles: z
    .object({
      primary_color: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .optional()
        .or(z.literal('')),
      cover_image_url: z.string().url().optional().or(z.literal('')),
    })
    .optional(),
});

type PublicProfileFormValues = z.infer<typeof publicProfileSchema>;

interface PublicProfileSettingsFormProps {
  accountId: string;
  accountName: string;
  accountSlug: string;
  currentProfile: Record<string, unknown>;
}

export function PublicProfileSettingsForm({
  accountId,
  accountName,
  accountSlug,
  currentProfile,
}: PublicProfileSettingsFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const form = useForm<PublicProfileFormValues>({
    resolver: zodResolver(publicProfileSchema),
    defaultValues: {
      is_public: (currentProfile.is_public as boolean) || false,
      display_name: (currentProfile.display_name as string) || '',
      bio: (currentProfile.bio as string) || '',
      website_url: (currentProfile.website_url as string) || '',
      social_links: {
        youtube:
          (currentProfile.social_links as Record<string, string>)?.youtube ||
          '',
        twitter:
          (currentProfile.social_links as Record<string, string>)?.twitter ||
          '',
        instagram:
          (currentProfile.social_links as Record<string, string>)?.instagram ||
          '',
      },
      custom_styles: {
        primary_color:
          (currentProfile.custom_styles as Record<string, string>)
            ?.primary_color || '',
        cover_image_url:
          (currentProfile.custom_styles as Record<string, string>)
            ?.cover_image_url || '',
      },
    },
  });

  const isPublic = form.watch('is_public');

  const onSubmit = (values: PublicProfileFormValues) => {
    startTransition(async () => {
      try {
        await unwrap(
          updatePublicProfileAction({
            accountId,
            publicProfile: values,
          }),
        );
        toast.success('Public profile updated');
        router.refresh();
      } catch (error) {
        toast.error(refusalMessage(error, 'Failed to update public profile'));
      }
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {/* Enable Public Profile */}
        <Card>
          <CardHeader>
            <CardTitle>Public Visibility</CardTitle>
            <CardDescription>
              Make your company profile visible at{' '}
              <code className="rounded bg-muted px-1">/@{accountSlug}</code>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FormField
              control={form.control}
              name="is_public"
              render={({ field }) => (
                <FormItem className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">
                      Enable Public Profile
                    </FormLabel>
                    <FormDescription>
                      When enabled, your company page will be visible to anyone
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
          </CardContent>
        </Card>

        {/* Profile Details */}
        {isPublic && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Profile Details</CardTitle>
                <CardDescription>
                  Customize how your company appears on the public page
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="display_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Display Name</FormLabel>
                      <FormControl>
                        <Input placeholder={accountName} {...field} />
                      </FormControl>
                      <FormDescription>
                        Leave blank to use your account name
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="bio"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Bio</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Tell viewers about your company..."
                          className="resize-none"
                          rows={3}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>Maximum 300 characters</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="website_url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Website URL</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="https://yourwebsite.com"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Social Links</CardTitle>
                <CardDescription>
                  Connect your social media profiles
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="social_links.youtube"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>YouTube Channel</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="https://youtube.com/@yourchannel"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="social_links.twitter"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Twitter / X</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="https://twitter.com/yourhandle"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="social_links.instagram"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Instagram</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="https://instagram.com/yourhandle"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Custom Styles</CardTitle>
                <CardDescription>
                  Personalize your public page appearance
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField
                  control={form.control}
                  name="custom_styles.primary_color"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Brand Color</FormLabel>
                      <FormControl>
                        <div className="flex gap-2">
                          <Input placeholder="#6366F1" {...field} />
                          {field.value &&
                            /^#[0-9A-Fa-f]{6}$/.test(field.value) && (
                              <div
                                className="h-10 w-10 rounded border"
                                style={{ backgroundColor: field.value }}
                              />
                            )}
                        </div>
                      </FormControl>
                      <FormDescription>
                        Hex color code (e.g., #6366F1)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="custom_styles.cover_image_url"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Cover Image URL</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="https://example.com/cover.jpg"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Header image for your public profile (1200x400
                        recommended)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </CardContent>
            </Card>
          </>
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={isPending}>
            {isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
