import { z } from 'zod';

/**
 * Videos an account must have tagged before tag-level medians are shown.
 * Below this, per-tag samples are too small to separate signal from the
 * luck that dominates individual video performance.
 */
export const TAGGED_LIBRARY_THRESHOLD = 30;

/**
 * Taxonomy dimensions. `hook_type` is shared with the Hook Lab
 * (FILM-1510), which reads its aggregate performance from tag medians.
 */
export const TagDimensionSchema = z.enum([
  'topic',
  'format',
  'thumbnail_style',
  'hook_type',
]);

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

export const CreateTagSchema = z.object({
  accountId: z.string().uuid(),
  dimension: TagDimensionSchema,
  slug: SlugSchema,
  label: z.string().min(1).max(120),
});

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

export const BulkTagPublishesSchema = z.object({
  publishIds: z.array(z.string().uuid()).min(1).max(500),
  tagIds: z.array(z.string().uuid()).min(1).max(50),
  /** Replace existing assignments instead of adding to them. */
  replace: z.boolean().default(false),
});
