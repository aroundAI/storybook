import { z } from 'zod';

export const GetRecentActivitySchema = z.object({
  accountId: z.string().uuid(),
  limit: z.number().int().min(1).max(50).default(10),
});

export type GetRecentActivityInput = z.infer<typeof GetRecentActivitySchema>;

export const GetActiveGenerationsSchema = z.object({
  accountId: z.string().uuid(),
});

export type GetActiveGenerationsInput = z.infer<
  typeof GetActiveGenerationsSchema
>;

export const GetScheduledPublishesSchema = z.object({
  accountId: z.string().uuid(),
  limit: z.number().int().min(1).max(20).default(5),
});

export type GetScheduledPublishesInput = z.infer<
  typeof GetScheduledPublishesSchema
>;

export const GetQuickStatsSchema = z.object({
  accountId: z.string().uuid(),
});

export type GetQuickStatsInput = z.infer<typeof GetQuickStatsSchema>;

export const GetRecentProjectsSchema = z.object({
  accountId: z.string().uuid(),
  limit: z.number().int().min(1).max(10).default(5),
});

export type GetRecentProjectsInput = z.infer<typeof GetRecentProjectsSchema>;
