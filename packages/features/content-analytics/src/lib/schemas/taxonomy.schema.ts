import { z } from 'zod';

import { TAG_DIMENSIONS, closedValuesFor } from '@kit/clickhouse';

/**
 * Videos an account must have tagged before tag-level medians are shown.
 * Below this, per-tag samples are too small to separate signal from the
 * luck that dominates individual video performance.
 */
export const TAGGED_LIBRARY_THRESHOLD = 30;

/**
 * Tag dimensions: taxonomy (what a video is) and genome attributes (what it
 * contains, FILM-1717). One list, `TAG_DIMENSIONS`, which the
 * `content_tags` CHECK is tested against — so the form cannot offer a
 * dimension the table refuses, or miss one it accepts.
 */
export const TagDimensionSchema = z.enum(TAG_DIMENSIONS);

export type TagDimension = z.infer<typeof TagDimensionSchema>;

/** Slugs are the stable machine key joined into ClickHouse video_dim.tags. */
const SlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'Use lowercase letters, numbers and hyphens',
  );

export const CreateTagSchema = z
  .object({
    accountId: z.string().uuid(),
    dimension: TagDimensionSchema,
    slug: SlugSchema,
    label: z.string().min(1).max(120),
  })
  .refine(
    (input) => closedValuesFor(input.dimension)?.includes(input.slug) ?? true,
    // On `label`: the slug is derived from it and has no field of its own,
    // so a message on `slug` would never be seen.
    (input) => ({
      message: `This dimension takes only: ${closedValuesFor(input.dimension)?.join(', ')}`,
      path: ['label'],
    }),
  );

export const DeleteTagSchema = z.object({
  tagId: z.string().uuid(),
});

export const ListTagsSchema = z.object({
  accountId: z.string().uuid(),
  dimension: TagDimensionSchema.optional(),
});

export const SetPublishTagsSchema = z.object({
  publishId: z.string().uuid(),
  tagIds: z.array(z.string().uuid()).max(50),
});

/** The most publishes and tags one bulk-tag call accepts. */
export const BULK_TAG_MAX_PUBLISHES = 500;
export const BULK_TAG_MAX_TAGS = 50;

export const BulkTagPublishesSchema = z.object({
  publishIds: z.array(z.string().uuid()).min(1).max(BULK_TAG_MAX_PUBLISHES),
  tagIds: z.array(z.string().uuid()).min(1).max(BULK_TAG_MAX_TAGS),
  /** Replace existing assignments instead of adding to them. */
  replace: z.boolean().default(false),
});
