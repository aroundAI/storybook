import { z } from 'zod';

/**
 * Schema for creating a project from a template
 * Used by the TemplatePreviewDialog form
 */
export const CreateFromTemplateSchema = z.object({
  projectName: z.string().min(1, 'Project name is required').max(255),
  projectDescription: z.string().max(1000).optional(),
});

export type CreateFromTemplateInput = z.infer<typeof CreateFromTemplateSchema>;
