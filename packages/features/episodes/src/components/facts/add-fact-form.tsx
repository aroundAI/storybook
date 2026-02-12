'use client';

import { useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, BookOpen, Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { toast } from '@kit/ui/sonner';
import { z } from 'zod';

import { generateAPACitation } from '@kit/episodes';
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
import { Slider } from '@kit/ui/slider';
import { Textarea } from '@kit/ui/textarea';

import { addVerifiedFactAction } from '../../server/fact-actions';

import { FACT_CATEGORIES, SOURCE_TYPES } from './fact-constants';

type SourceTypeValue = (typeof SOURCE_TYPES)[number]['value'];
const [firstSourceType, ...restSourceTypes] = SOURCE_TYPES.map((s) => s.value);
const sourceTypeValues = [firstSourceType!, ...restSourceTypes] as const satisfies readonly [SourceTypeValue, ...SourceTypeValue[]];

const CROSSREF_API_URL = 'https://api.crossref.org/works/';

const CrossRefAuthorSchema = z.object({
    family: z.string().optional(),
    given: z.string().optional(),
});

const CrossRefWorkSchema = z.object({
    title: z.array(z.string()).optional(),
    author: z.array(CrossRefAuthorSchema).optional(),
    published: z.object({ 'date-parts': z.array(z.array(z.number())).optional() }).optional(),
    'container-title': z.array(z.string()).optional(),
});

const CrossRefResponseSchema = z.object({
    message: CrossRefWorkSchema,
});

const addFactSchema = z.object({
    claim: z.string().min(10, 'Claim must be at least 10 characters'),
    category: z.string().optional(),
    subcategory: z.string().optional(),
    tags: z.string().default(''),
    sourceType: z.enum(sourceTypeValues),
    sourceUrl: z.string().optional(),
    sourceCitation: z.string().min(10, 'Citation must be at least 10 characters'),
    sourceTitle: z.string().optional(),
    sourceAuthors: z.string().optional(),
    sourceDoi: z.string().optional(),
    confidenceScore: z.number().min(0).max(1).default(0.8),
});

type AddFactValues = z.infer<typeof addFactSchema>;


interface AddFactFormProps {
    projectId: string;
    basePath: string;
}

export function AddFactForm({ projectId, basePath }: AddFactFormProps) {
    const router = useRouter();
    const [isPending, startTransition] = useTransition();
    const [doiInput, setDoiInput] = useState('');
    const [isLoadingDoi, setIsLoadingDoi] = useState(false);

    const form = useForm<AddFactValues>({
        resolver: zodResolver(addFactSchema),
        defaultValues: {
            sourceType: 'research_paper',
            tags: '',
            confidenceScore: 0.8,
            claim: '',
            sourceCitation: '',
        },
    });

    async function handleDoiLookup() {
        if (!doiInput.trim()) return;

        setIsLoadingDoi(true);

        try {
            const response = await fetch(
                `${CROSSREF_API_URL}${encodeURIComponent(doiInput.trim())}`,
            );

            if (!response.ok) {
                toast.error('DOI not found');
                return;
            }

            const rawData = await response.json();
            const parsed = CrossRefResponseSchema.safeParse(rawData);

            if (!parsed.success) {
                toast.error('Unexpected response format from CrossRef');
                return;
            }

            const work = parsed.data.message;

            const authors: string[] =
                work.author?.map(
                    (a) => `${a.family ?? ''}, ${a.given?.[0] ?? ''}.`,
                ) ?? [];

            const year =
                work.published?.['date-parts']?.[0]?.[0] ??
                new Date().getFullYear();
            const title = work.title?.[0] ?? '';
            const journal = work['container-title']?.[0] ?? '';

            form.setValue('sourceTitle', title);
            form.setValue('sourceAuthors', authors.join(', '));
            form.setValue('sourceDoi', doiInput.trim());
            form.setValue(
                'sourceCitation',
                generateAPACitation(authors, year, title, journal, undefined, doiInput.trim()),
            );

            toast.success('Citation auto-filled from DOI');
        } catch {
            toast.error('Failed to lookup DOI');
        } finally {
            setIsLoadingDoi(false);
        }
    }

    function onSubmit(values: AddFactValues) {
        startTransition(async () => {
            // Parse comma-separated tags
            const tags = values.tags
                ? values.tags
                    .split(',')
                    .map((t) => t.trim())
                    .filter(Boolean)
                : [];

            try {
                await addVerifiedFactAction({
                    projectId,
                    basePath,
                    claim: values.claim,
                    category: values.category,
                    subcategory: values.subcategory,
                    tags,
                    sourceType: values.sourceType,
                    sourceUrl: values.sourceUrl || undefined,
                    sourceCitation: values.sourceCitation,
                    sourceTitle: values.sourceTitle,
                    sourceAuthors: values.sourceAuthors,
                    sourceDoi: values.sourceDoi,
                    confidenceScore: values.confidenceScore,
                });

                toast.success('Fact added successfully');
                router.push(basePath);
                router.refresh();
            } catch {
                toast.error('Failed to add fact');
            }
        });
    }

    return (
        <div className="space-y-6">
            <Button variant="ghost" size="sm" onClick={() => router.push(basePath)}>
                <ArrowLeft className="h-4 w-4 mr-1.5" />
                Back to Fact Library
            </Button>

            {/* DOI Quick-add */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <BookOpen className="h-4 w-4" />
                        Quick Add via DOI
                    </CardTitle>
                    <CardDescription>
                        Enter a DOI to auto-fill source citation details.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex gap-2">
                        <Input
                            placeholder="10.1234/example.doi"
                            value={doiInput}
                            onChange={(e) => setDoiInput(e.target.value)}
                            className="flex-1"
                        />
                        <Button
                            type="button"
                            variant="secondary"
                            onClick={handleDoiLookup}
                            disabled={isLoadingDoi || !doiInput.trim()}
                        >
                            {isLoadingDoi ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                'Lookup'
                            )}
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Main Form */}
            <Card>
                <CardHeader>
                    <CardTitle>Add Verified Fact</CardTitle>
                    <CardDescription>
                        Add a factual claim with its source citation.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <Form {...form}>
                        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                            {/* Claim */}
                            <FormField
                                control={form.control}
                                name="claim"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Factual Claim</FormLabel>
                                        <FormControl>
                                            <Textarea
                                                placeholder="The speed of light in a vacuum is approximately 299,792,458 meters per second."
                                                rows={3}
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormDescription>
                                            State the fact clearly and precisely.
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {/* Category & Subcategory */}
                            <div className="grid grid-cols-2 gap-4">
                                <FormField
                                    control={form.control}
                                    name="category"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Category</FormLabel>
                                            <Select
                                                onValueChange={field.onChange}
                                                defaultValue={field.value}
                                            >
                                                <FormControl>
                                                    <SelectTrigger>
                                                        <SelectValue placeholder="Select category" />
                                                    </SelectTrigger>
                                                </FormControl>
                                                <SelectContent>
                                                    {FACT_CATEGORIES.map((cat) => (
                                                        <SelectItem
                                                            key={cat}
                                                            value={cat}
                                                        >
                                                            {cat.charAt(0).toUpperCase() + cat.slice(1)}
                                                        </SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />

                                <FormField
                                    control={form.control}
                                    name="subcategory"
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Subcategory</FormLabel>
                                            <FormControl>
                                                <Input
                                                    placeholder="e.g. Optics, WWII"
                                                    {...field}
                                                />
                                            </FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            </div>

                            {/* Tags */}
                            <FormField
                                control={form.control}
                                name="tags"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Tags</FormLabel>
                                        <FormControl>
                                            <Input
                                                placeholder="speed of light, physics, relativity"
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormDescription>
                                            Comma-separated tags for search.
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {/* Source Type */}
                            <FormField
                                control={form.control}
                                name="sourceType"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Source Type</FormLabel>
                                        <Select
                                            onValueChange={field.onChange}
                                            defaultValue={field.value}
                                        >
                                            <FormControl>
                                                <SelectTrigger>
                                                    <SelectValue />
                                                </SelectTrigger>
                                            </FormControl>
                                            <SelectContent>
                                                {SOURCE_TYPES.map((st) => (
                                                    <SelectItem
                                                        key={st.value}
                                                        value={st.value}
                                                    >
                                                        {st.label}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {/* Source URL */}
                            <FormField
                                control={form.control}
                                name="sourceUrl"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Source URL</FormLabel>
                                        <FormControl>
                                            <Input
                                                type="url"
                                                placeholder="https://..."
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {/* Citation */}
                            <FormField
                                control={form.control}
                                name="sourceCitation"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Full Citation (APA Format)</FormLabel>
                                        <FormControl>
                                            <Textarea
                                                placeholder="Smith, J. (2023). The Science of Everything. Nature. https://doi.org/10.1234/..."
                                                rows={3}
                                                {...field}
                                            />
                                        </FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            {/* Confidence */}
                            <FormField
                                control={form.control}
                                name="confidenceScore"
                                render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>
                                            Confidence Level: {Math.round(field.value * 100)}%
                                        </FormLabel>
                                        <FormControl>
                                            <Slider
                                                min={0}
                                                max={100}
                                                step={5}
                                                value={[Math.round(field.value * 100)]}
                                                onValueChange={([v]) => {
                                                    if (v !== undefined) {
                                                        field.onChange(v / 100);
                                                    }
                                                }}
                                            />
                                        </FormControl>
                                        <FormDescription>
                                            How confident are you in this source?
                                        </FormDescription>
                                        <FormMessage />
                                    </FormItem>
                                )}
                            />

                            <div className="flex gap-3 pt-2">
                                <Button type="submit" disabled={isPending}>
                                    {isPending ? (
                                        <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                                    ) : null}
                                    Add Fact
                                </Button>
                                <Button
                                    type="button"
                                    variant="outline"
                                    onClick={() => router.push(basePath)}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </form>
                    </Form>
                </CardContent>
            </Card>
        </div>
    );
}
