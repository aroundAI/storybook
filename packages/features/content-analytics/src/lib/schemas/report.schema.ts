import { z } from 'zod';

/**
 * Report metric enum - metrics that can be included in reports
 */
export const ReportMetricSchema = z.enum([
  'views',
  'watchTime',
  'likes',
  'comments',
  'shares',
  'subscribers',
  'revenue',
  'retention',
  'ctr',
  'avgViewDuration',
]);

/**
 * Platform enum - supported publishing platforms
 */
export const ReportPlatformSchema = z.enum([
  'youtube',
  'tiktok',
  'instagram',
  'facebook',
]);

/**
 * Date preset enum - predefined date ranges
 */
export const DatePresetSchema = z.enum([
  'last7days',
  'last30days',
  'lastMonth',
  'lastQuarter',
  'custom',
]);

/**
 * Branding configuration for PDF reports
 */
export const BrandingSchema = z.object({
  logoUrl: z.string().url().optional(),
  primaryColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  companyName: z.string().max(100).optional(),
});

/**
 * Date range schema with preset support
 */
export const DateRangeSchema = z.object({
  start: z.coerce.date(),
  end: z.coerce.date(),
  preset: DatePresetSchema.optional(),
});

/**
 * Schema for generating a report
 */
export const GenerateReportSchema = z.object({
  accountId: z.string().uuid(),
  config: z.object({
    type: z.enum(['pdf', 'csv']),
    dateRange: DateRangeSchema,
    metrics: z.array(ReportMetricSchema).min(1, 'Select at least one metric'),
    platforms: z
      .array(ReportPlatformSchema)
      .min(1, 'Select at least one platform'),
    projectIds: z.array(z.string().uuid()).optional(),
    branding: BrandingSchema.optional(),
  }),
});

/**
 * Schema for creating a scheduled report
 */
export const CreateScheduledReportSchema = z.object({
  accountId: z.string().uuid(),
  name: z.string().min(1, 'Name is required').max(255),
  reportType: z.enum(['pdf', 'csv', 'raw_csv']),
  frequency: z.enum(['weekly', 'monthly']),
  metrics: z.array(ReportMetricSchema).min(1, 'Select at least one metric'),
  platforms: z
    .array(ReportPlatformSchema)
    .min(1, 'Select at least one platform'),
  projectIds: z.array(z.string().uuid()).optional(),
  branding: BrandingSchema.optional(),
  recipients: z
    .array(z.string().email('Invalid email address'))
    .min(1, 'At least one recipient required'),
});

/**
 * Schema for updating a scheduled report
 */
export const UpdateScheduledReportSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  reportType: z.enum(['pdf', 'csv', 'raw_csv']).optional(),
  frequency: z.enum(['weekly', 'monthly']).optional(),
  metrics: z.array(ReportMetricSchema).min(1).optional(),
  platforms: z.array(ReportPlatformSchema).min(1).optional(),
  projectIds: z.array(z.string().uuid()).nullish(),
  branding: BrandingSchema.nullish(),
  recipients: z.array(z.string().email()).min(1).optional(),
  isActive: z.boolean().optional(),
});

/**
 * Schema for deleting a scheduled report
 */
export const DeleteScheduledReportSchema = z.object({
  id: z.string().uuid(),
});

/**
 * Schema for fetching scheduled reports for an account
 */
export const GetScheduledReportsSchema = z.object({
  accountId: z.string().uuid(),
});

export const REPORT_HISTORY_PAGE_SIZE = 10;

/**
 * Schema for reading an account's report history, newest first
 */
export const ListGeneratedReportsSchema = z.object({
  accountId: z.string().uuid(),
  limit: z.number().int().min(1).max(50),
  offset: z.number().int().min(0),
});

/**
 * Schema for acting on one history row
 */
export const GeneratedReportIdSchema = z.object({
  id: z.string().uuid(),
});
