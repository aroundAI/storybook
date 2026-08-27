/**
 * Revenue Tracking Zod Schemas - FILM-810
 * Validation schemas for revenue server actions
 */
import { z } from 'zod';

/**
 * Schema for getting revenue summary
 */
export const GetRevenueSummarySchema = z.object({
  accountId: z.string().uuid(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
});

export type GetRevenueSummaryInput = z.infer<typeof GetRevenueSummarySchema>;

/**
 * Schema for adding manual revenue entry
 */
/**
 * Revenue categories. Watching `ads` fall as a share of the total is the
 * monetization health signal, so every record carries one.
 */
export const RevenueCategorySchema = z.enum([
  'ads',
  'premium',
  'sponsorship',
  'product',
  'affiliate',
  'other',
]);

export type RevenueCategory = z.infer<typeof RevenueCategorySchema>;

/**
 * Manual revenue entry. Sponsorship and product income is often
 * channel-level, so a record attaches to either a publish or an account.
 */
export const AddManualRevenueSchema = z
  .object({
    publishId: z.string().uuid().optional(),
    accountId: z.string().uuid().optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
    revenueCents: z.number().int().min(0),
    currency: z.string().length(3).optional().default('USD'),
    category: RevenueCategorySchema.default('sponsorship'),
    notes: z.string().max(1000).optional(),
  })
  .refine((data) => data.publishId ?? data.accountId, {
    message: 'Provide either a publish or an account',
    path: ['publishId'],
  });

export type AddManualRevenueInput = z.infer<typeof AddManualRevenueSchema>;

/**
 * Schema for generating revenue report
 */
export const GenerateRevenueReportSchema = z.object({
  accountId: z.string().uuid(),
  periodType: z.enum(['monthly', 'quarterly', 'yearly', 'custom']),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  format: z.enum(['pdf', 'csv', 'json']).optional(),
});

export type GenerateRevenueReportInput = z.infer<
  typeof GenerateRevenueReportSchema
>;

/**
 * Schema for getting revenue projection
 */
export const GetRevenueProjectionSchema = z.object({
  accountId: z.string().uuid(),
});

export type GetRevenueProjectionInput = z.infer<
  typeof GetRevenueProjectionSchema
>;

/**
 * Schema for getting revenue time series data
 */
export const GetRevenueTimeSeriesSchema = z.object({
  accountId: z.string().uuid(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  groupBy: z.enum(['day', 'week', 'month']).optional(),
});

export type GetRevenueTimeSeriesInput = z.infer<
  typeof GetRevenueTimeSeriesSchema
>;

/**
 * Schema for getting top content by revenue
 */
export const GetTopContentByRevenueSchema = z.object({
  accountId: z.string().uuid(),
  startDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  endDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  limit: z.number().int().min(1).max(100).optional().default(10),
});

export type GetTopContentByRevenueInput = z.infer<
  typeof GetTopContentByRevenueSchema
>;

/**
 * Schema for syncing revenue from platform
 */
export const SyncRevenueFromPlatformSchema = z.object({
  publishId: z.string().uuid(),
});

export type SyncRevenueFromPlatformInput = z.infer<
  typeof SyncRevenueFromPlatformSchema
>;

/**
 * Schema for deleting manual revenue entry
 */
export const DeleteManualRevenueSchema = z
  .object({
    publishId: z.string().uuid().optional(),
    accountId: z.string().uuid().optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
    category: RevenueCategorySchema.optional(),
  })
  .refine((data) => data.publishId ?? data.accountId, {
    message: 'Provide either a publish or an account',
    path: ['publishId'],
  });

export type DeleteManualRevenueInput = z.infer<
  typeof DeleteManualRevenueSchema
>;
