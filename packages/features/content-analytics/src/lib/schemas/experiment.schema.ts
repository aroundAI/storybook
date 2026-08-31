import { z } from 'zod';

export const ExperimentStatusSchema = z.enum([
  'planned',
  'running',
  'concluded',
  'abandoned',
]);

export const ExperimentOutcomeSchema = z.enum([
  'pending',
  'confirmed',
  'rejected',
  'inconclusive',
]);

export type ExperimentStatus = z.infer<typeof ExperimentStatusSchema>;
export type ExperimentOutcome = z.infer<typeof ExperimentOutcomeSchema>;

export const CreateExperimentSchema = z.object({
  accountId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  title: z.string().min(1).max(200),
  hypothesis: z.string().max(2000).optional(),
  changeDescription: z.string().min(1).max(2000),
  expectedOutcome: z.string().max(2000).optional(),
  publishIds: z.array(z.string().uuid()).max(200).default([]),
  tagIds: z.array(z.string().uuid()).max(50).default([]),
});

export const UpdateExperimentSchema = z.object({
  experimentId: z.string().uuid(),
  title: z.string().min(1).max(200).optional(),
  hypothesis: z.string().max(2000).optional(),
  changeDescription: z.string().min(1).max(2000).optional(),
  expectedOutcome: z.string().max(2000).optional(),
  publishIds: z.array(z.string().uuid()).max(200).optional(),
  tagIds: z.array(z.string().uuid()).max(50).optional(),
});

export const StartExperimentSchema = z.object({
  experimentId: z.string().uuid(),
  /** Defaults to today. */
  startedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const ConcludeExperimentSchema = z.object({
  experimentId: z.string().uuid(),
  /** What actually happened — required, since that is the point of the log. */
  actualOutcome: z.string().min(1).max(2000),
  outcomeStatus: ExperimentOutcomeSchema.exclude(['pending']),
  endedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

export const AbandonExperimentSchema = z.object({
  experimentId: z.string().uuid(),
  reason: z.string().max(2000).optional(),
});

export const ListExperimentsSchema = z.object({
  accountId: z.string().uuid(),
  projectId: z.string().uuid().optional(),
  status: ExperimentStatusSchema.optional(),
});

export const GetExperimentSchema = z.object({
  experimentId: z.string().uuid(),
});

export const DeleteExperimentSchema = z.object({
  experimentId: z.string().uuid(),
});
