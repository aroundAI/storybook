import { z } from 'zod';

// Project role enum schema
export const ProjectRoleSchema = z.enum(['owner', 'admin', 'member', 'viewer']);

// Project status enum schema
export const ProjectStatusSchema = z.enum(['active', 'archived', 'deleted']);

// Create project schema
export const CreateProjectSchema = z.object({
  account_id: z.string().uuid(),
  name: z
    .string()
    .min(1, 'Project name is required')
    .max(255, 'Project name must be 255 characters or less'),
  description: z
    .string()
    .max(1000, 'Description must be 1000 characters or less')
    .optional(),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(
      /^[a-z0-9-]+$/,
      'Slug must contain only lowercase letters, numbers, and hyphens',
    )
    .optional(),
  metadata: z.record(z.unknown()).optional(),
});

// Update project schema
export const UpdateProjectSchema = z.object({
  id: z.string().uuid(),
  name: z
    .string()
    .min(1, 'Project name is required')
    .max(255, 'Project name must be 255 characters or less')
    .optional(),
  description: z
    .string()
    .max(1000, 'Description must be 1000 characters or less')
    .nullable()
    .optional(),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(
      /^[a-z0-9-]+$/,
      'Slug must contain only lowercase letters, numbers, and hyphens',
    )
    .optional(),
  status: ProjectStatusSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
});

// Add project member schema
export const AddProjectMemberSchema = z.object({
  project_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: ProjectRoleSchema,
});

// Update project member schema
export const UpdateProjectMemberSchema = z.object({
  project_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: ProjectRoleSchema,
});

// Remove project member schema
export const RemoveProjectMemberSchema = z.object({
  project_id: z.string().uuid(),
  user_id: z.string().uuid(),
});

// Delete project schema
export const DeleteProjectSchema = z.object({
  id: z.string().uuid(),
});

// Get project schema
export const GetProjectSchema = z.object({
  id: z.string().uuid(),
});

// Get account projects schema
export const GetAccountProjectsSchema = z.object({
  account_id: z.string().uuid(),
});
