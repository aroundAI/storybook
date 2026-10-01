'use client';

import { useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';

import {
  GENOME_OBSERVABLE_DIMENSIONS,
  TAXONOMY_DIMENSIONS,
  closedValuesFor,
} from '@kit/clickhouse';
import { Badge } from '@kit/ui/badge';
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';

import { CreateTagSchema } from '../../lib/schemas/taxonomy.schema';
import type { TagDimension } from '../../lib/schemas/taxonomy.schema';

/** A taxonomy tag as returned by listTagsAction. */
export interface ContentTag {
  id: string;
  dimension: string;
  slug: string;
  label: string;
}

interface TagManagerProps {
  /** Account the vocabulary belongs to */
  accountId: string;
  /** Existing tags across all dimensions */
  tags: ContentTag[];
  /** Persists a new tag; resolves once saved */
  onCreate: (input: {
    accountId: string;
    dimension: TagDimension;
    slug: string;
    label: string;
  }) => Promise<void>;
  /** Removes a tag and its assignments */
  onDelete: (tagId: string) => Promise<void>;
}

const DIMENSION_LABELS: Record<TagDimension, string> = {
  topic: 'Topic',
  format: 'Format',
  thumbnail_style: 'Thumbnail style',
  hook_type: 'Hook type',
  opening_visual: 'Opening visual',
  first_sentence: 'First sentence',
  face_present: 'Face present',
  text_present: 'Text on screen',
  cuts_per_minute: 'Cuts per minute',
  scene_changes: 'Scene changes',
  question_first_3s: 'Question in first 3s',
  result_first: 'Result first',
};

/**
 * Two kinds of tag, kept apart on screen as they are in the data
 * (FILM-1717): what a video is, and the creative mechanisms it contains.
 */
const DIMENSION_GROUPS: ReadonlyArray<{
  id: string;
  label: string;
  dimensions: readonly TagDimension[];
}> = [
  {
    id: 'taxonomy',
    label: 'What the video is',
    dimensions: TAXONOMY_DIMENSIONS,
  },
  {
    id: 'genome',
    label: 'Creative mechanisms',
    dimensions: GENOME_OBSERVABLE_DIMENSIONS,
  },
];

/** Derives a URL-safe slug so users only have to type a label. */
function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80);
}

/**
 * Manages an account's controlled tagging vocabulary. Tag-level medians
 * are only meaningful against a stable vocabulary, so tags are created
 * deliberately here rather than typed free-form at assignment time.
 */
export function TagManager({
  accountId,
  tags,
  onCreate,
  onDelete,
}: TagManagerProps) {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const form = useForm({
    resolver: zodResolver(CreateTagSchema),
    defaultValues: {
      accountId,
      dimension: 'topic' as TagDimension,
      slug: '',
      label: '',
    },
  });

  const isSubmitting = form.formState.isSubmitting;
  const closedValues = closedValuesFor(form.watch('dimension'));

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await onCreate(values);
      form.reset({
        accountId,
        dimension: values.dimension,
        slug: '',
        label: '',
      });
      toast.success(`Added "${values.label}"`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not create the tag',
      );
    }
  });

  const handleDelete = async (tag: ContentTag) => {
    setPendingDelete(tag.id);
    try {
      await onDelete(tag.id);
      toast.success(`Removed "${tag.label}"`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Could not delete the tag',
      );
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <div className={'flex flex-col gap-8'}>
      <Form {...form}>
        <form
          onSubmit={onSubmit}
          className={'flex flex-col gap-4 sm:flex-row sm:items-end'}
          data-test={'create-tag-form'}
        >
          <FormField
            control={form.control}
            name={'dimension'}
            render={({ field }) => (
              <FormItem className={'sm:w-48'}>
                <FormLabel>Dimension</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl>
                    <SelectTrigger data-test={'tag-dimension-trigger'}>
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {DIMENSION_GROUPS.map((group) => (
                      <SelectGroup key={group.id}>
                        <SelectLabel>{group.label}</SelectLabel>
                        {group.dimensions.map((dimension) => (
                          <SelectItem
                            key={dimension}
                            value={dimension}
                            data-test={`tag-dimension-${dimension}`}
                          >
                            {DIMENSION_LABELS[dimension]}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name={'label'}
            render={({ field }) => (
              <FormItem className={'flex-1'}>
                <FormLabel>Label</FormLabel>
                <FormControl>
                  <Input
                    placeholder={'e.g. Process explainer'}
                    {...field}
                    onChange={(event) => {
                      field.onChange(event);
                      form.setValue('slug', slugify(event.target.value), {
                        shouldValidate: true,
                      });
                    }}
                  />
                </FormControl>
                {closedValues ? (
                  <FormDescription data-test={'tag-closed-values'}>
                    Takes only: {closedValues.join(', ')}
                  </FormDescription>
                ) : null}
                <FormMessage data-test={'tag-label-error'} />
              </FormItem>
            )}
          />

          <Button type={'submit'} disabled={isSubmitting}>
            {isSubmitting ? (
              <Loader2 className={'mr-2 h-4 w-4 animate-spin'} />
            ) : (
              <Plus className={'mr-2 h-4 w-4'} />
            )}
            Add tag
          </Button>
        </form>
      </Form>

      {DIMENSION_GROUPS.map((group) => (
        <div
          key={group.id}
          className={'flex flex-col gap-6'}
          data-test={`tag-group-${group.id}`}
        >
          <h2 className={'text-base font-semibold'}>{group.label}</h2>
          {group.dimensions.map((dimension) => {
            const dimensionTags = tags.filter((t) => t.dimension === dimension);

            return (
              <div
                key={dimension}
                className={'flex flex-col gap-2'}
                data-test={`tag-section-${dimension}`}
              >
                <h3 className={'text-sm font-medium'}>
                  {DIMENSION_LABELS[dimension]}
                </h3>

                {dimensionTags.length === 0 ? (
                  <p className={'text-sm text-muted-foreground'}>
                    No tags yet.
                  </p>
                ) : (
                  <div className={'flex flex-wrap gap-2'}>
                    {dimensionTags.map((tag) => (
                      <Badge
                        key={tag.id}
                        variant={'secondary'}
                        className={'gap-1 py-1 pr-1 pl-2'}
                      >
                        {tag.label}
                        <Button
                          type={'button'}
                          variant={'ghost'}
                          size={'icon'}
                          className={'h-5 w-5'}
                          aria-label={`Delete ${tag.label}`}
                          disabled={pendingDelete === tag.id}
                          onClick={() => handleDelete(tag)}
                        >
                          {pendingDelete === tag.id ? (
                            <Loader2 className={'h-3 w-3 animate-spin'} />
                          ) : (
                            <Trash2 className={'h-3 w-3'} />
                          )}
                        </Button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
