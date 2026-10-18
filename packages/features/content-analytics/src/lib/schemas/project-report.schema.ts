import { z } from 'zod';

/** FILM-1735. A project's morning report, as a client saves and reads it */

export const ReportDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'A calendar day, YYYY-MM-DD')
  .refine((day) => !Number.isNaN(Date.parse(`${day}T00:00:00Z`)), {
    message: 'Not a calendar day',
  });

/** An IANA zone the runtime can read: the day's edges are worked out in it */
export const ReportTimeZone = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/, 'An IANA zone name')
  .refine(isTimeZone, { message: 'Not a time zone this server knows' });

export function isTimeZone(zone: string) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const MAX_REPORT_CHARS = 40_000;

/** What the page shows above a report; nothing else is stored beside it */
export const ReportSummarySchema = z
  .object({
    headline: z.string().max(500).optional(),
    /** Each platform's latest data day, as the digest's freshness said */
    dataThrough: z.record(z.string().max(40), ReportDay).optional(),
  })
  .strict();

export type ReportSummary = z.infer<typeof ReportSummarySchema>;

export const SaveProjectReportSchema = z.object({
  projectId: z.string().uuid(),
  date: ReportDay,
  timezone: ReportTimeZone,
  digestHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'The digestHash get_daily_digest returned'),
  bodyMd: z.string().min(1).max(MAX_REPORT_CHARS),
  summary: ReportSummarySchema.default({}),
  model: z.string().min(1).max(200),
});

export type SaveProjectReportInput = z.infer<typeof SaveProjectReportSchema>;

/** The longest span list_project_reports reads at once */
export const MAX_REPORT_LIST_DAYS = 92;
