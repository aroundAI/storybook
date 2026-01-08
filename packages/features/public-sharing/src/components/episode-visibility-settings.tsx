'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@kit/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';
import { Globe, Lock, Link as LinkIcon, Eye, ArrowDownToLine } from 'lucide-react';

import { updateEpisodeVisibilityAction } from '@kit/public-sharing/server/visibility-actions';

const episodeVisibilitySchema = z.object({
    visibility: z.enum(['inherit', 'private', 'public', 'unlisted']),
    public_slug: z.string().regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers, and hyphens allowed').min(3).max(50).optional().or(z.literal('')),
});

type EpisodeVisibilityFormValues = z.infer<typeof episodeVisibilitySchema>;

interface EpisodeVisibilitySettingsProps {
    episodeId: string;
    episodeTitle: string;
    projectVisibility: string;
    accountSlug: string;
    projectSlug: string;
    currentVisibility: string;
    currentPublicSlug: string | null;
}

const VISIBILITY_OPTIONS = [
    {
        value: 'inherit',
        label: 'Inherit from Project',
        description: 'Use the same visibility as the project',
        icon: ArrowDownToLine,
    },
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

function generateSlug(title: string): string {
    return title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 50);
}

export function EpisodeVisibilitySettings({
    episodeId,
    episodeTitle,
    projectVisibility,
    accountSlug,
    projectSlug,
    currentVisibility,
    currentPublicSlug,
}: EpisodeVisibilitySettingsProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();

    const form = useForm<EpisodeVisibilityFormValues>({
        resolver: zodResolver(episodeVisibilitySchema),
        defaultValues: {
            visibility: (currentVisibility as 'inherit' | 'private' | 'public' | 'unlisted') || 'inherit',
            public_slug: currentPublicSlug || generateSlug(episodeTitle),
        },
    });

    const visibility = form.watch('visibility');
    const publicSlug = form.watch('public_slug');
    const effectiveVisibility = visibility === 'inherit' ? projectVisibility : visibility;
    const showSlugField = effectiveVisibility === 'public' || effectiveVisibility === 'unlisted';

    const onSubmit = (values: EpisodeVisibilityFormValues) => {
        startTransition(async () => {
            try {
                await updateEpisodeVisibilityAction({
                    episodeId,
                    visibility: values.visibility,
                    publicSlug: values.public_slug || undefined,
                });
                toast.success('Episode visibility updated');
                router.refresh();
            } catch {
                toast.error('Failed to update episode visibility');
            }
        });
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Eye className="h-5 w-5" />
                    Episode Visibility
                </CardTitle>
                <CardDescription>
                    Override the project&apos;s visibility setting for this episode
                </CardDescription>
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
                                    {visibility === 'inherit' && (
                                        <FormDescription>
                                            Currently inheriting: <strong>{projectVisibility}</strong> from project
                                        </FormDescription>
                                    )}
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        {showSlugField && (
                            <FormField
                                control={form.control}
                                name="public_slug"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Public URL Slug</FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="episode-title"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormDescription>
                                            Episode URL:{' '}
                                            <code className="bg-muted px-1 rounded text-xs">
                                                /@{accountSlug}/{projectSlug}/e/{publicSlug || 'slug'}
                                            </code>
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />
                        )}

                        <div className="flex justify-end">
                            <Button type="submit" disabled={isPending}>
                                {isPending ? 'Saving...' : 'Save'}
                            </Button>
                        </div>
                    </form>
                </Form>
            </CardContent>
        </Card>
    );
}
