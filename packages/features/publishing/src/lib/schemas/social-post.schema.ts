import { z } from 'zod';

export const CreateSocialPostSchema = z.object({
  accountId: z.string().uuid(),
  rawNotes: z.string().min(10).max(10000),
  platformConnectionId: z.string().uuid().optional(),
  tone: z.string().optional(),
  authorContext: z.string().optional(),
  enableResearch: z.boolean().default(true),
});

export const UpdateSocialPostSchema = z.object({
  postId: z.string().uuid(),
  finalText: z.string().max(3000).optional(),
  selectedVariantIndex: z.number().int().min(0).optional(),
  hashtags: z.array(z.string()).optional(),
  visibility: z.enum(['PUBLIC', 'CONNECTIONS']).optional(),
  platformConnectionId: z.string().uuid().optional(),
});

export const DeleteSocialPostSchema = z.object({
  postId: z.string().uuid(),
});

export const GetSocialPostsSchema = z.object({
  accountId: z.string().uuid(),
  status: z
    .enum([
      'draft',
      'ready_to_review',
      'approved',
      'publishing',
      'published',
      'failed',
    ])
    .optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

export const GetSocialPostSchema = z.object({
  postId: z.string().uuid(),
});

export const ApproveSocialPostSchema = z.object({
  postId: z.string().uuid(),
  platformConnectionId: z.string().uuid(),
});

export const PublishSocialPostSchema = z.object({
  postId: z.string().uuid(),
});

export const RegenerateVariantsSchema = z.object({
  postId: z.string().uuid(),
  tone: z.string().optional(),
  authorContext: z.string().optional(),
});
