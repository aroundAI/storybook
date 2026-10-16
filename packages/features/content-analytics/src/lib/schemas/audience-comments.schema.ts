import { z } from 'zod';

import {
  COMMENT_SENTIMENTS,
  COMMENT_TOPICS,
} from '../audience-comments/labels';

/** FILM-1733. A project's or an episode's comments: exactly one */
export const CommentScopeSchema = z
  .object({
    projectId: z.string().uuid().optional(),
    episodeId: z.string().uuid().optional(),
  })
  .refine((scope) => !!scope.projectId !== !!scope.episodeId, {
    message: 'Name a project or an episode',
  });

export const ListAudienceCommentsSchema = z.object({
  projectId: z.string().uuid().optional(),
  episodeId: z.string().uuid().optional(),
  sentiment: z.enum(COMMENT_SENTIMENTS).optional(),
  topic: z.enum(COMMENT_TOPICS).optional(),
  unlabelled: z.boolean().optional(),
  limit: z.number().int().min(1).max(50).default(20),
  after: z
    .object({
      commentedAt: z.string().datetime({ offset: true }),
      id: z.string().uuid(),
    })
    .optional(),
});
