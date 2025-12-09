/**
 * Continuity Checker Schemas
 *
 * Zod validation schemas for continuity checking server actions.
 */
import { z } from 'zod';

/**
 * Schema for check continuity action input
 */
export const CheckContinuitySchema = z.object({
  episodeId: z.string().uuid(),
});

/**
 * Schema for fix continuity issue action input
 */
export const FixContinuityIssueSchema = z.object({
  episodeId: z.string().uuid(),
  issueId: z.string().min(1),
});

// Inferred types
export type CheckContinuityInput = z.infer<typeof CheckContinuitySchema>;
export type FixContinuityIssueInput = z.infer<typeof FixContinuityIssueSchema>;
