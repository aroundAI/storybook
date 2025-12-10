import type { TemplateCategory, TemplateData } from '@kit/film-studio-schemas';

/**
 * Project Template interface matching database schema
 */
export interface ProjectTemplate {
  id: string;
  accountId: string | null;
  name: string;
  description: string | null;
  thumbnailUrl: string | null;
  category: TemplateCategory;
  genre: string | null;
  targetDurationMinutes: number | null;
  isSystem: boolean;
  isPublic: boolean;
  templateData: TemplateData;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/**
 * Database row type for project_templates
 */
export interface ProjectTemplateRow {
  id: string;
  account_id: string | null;
  name: string;
  description: string | null;
  thumbnail_url: string | null;
  category: string;
  genre: string | null;
  target_duration_minutes: number | null;
  is_system: boolean;
  is_public: boolean;
  template_data: Record<string, unknown>;
  usage_count: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Response type for getTemplates with pagination
 */
export interface GetTemplatesResponse {
  templates: ProjectTemplate[];
  total: number;
  hasMore: boolean;
}

/**
 * Response type for createProjectFromTemplate
 */
export interface CreateProjectFromTemplateResponse {
  success: boolean;
  projectId: string;
  projectSlug: string;
  assetsCreated: {
    characters: number;
    locations: number;
  };
}

/**
 * Response type for saveProjectAsTemplate
 */
export interface SaveProjectAsTemplateResponse {
  success: boolean;
  templateId: string;
}

/**
 * Transform database row to ProjectTemplate type
 */
export function mapRowToTemplate(row: ProjectTemplateRow): ProjectTemplate {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    description: row.description,
    thumbnailUrl: row.thumbnail_url,
    category: row.category as TemplateCategory,
    genre: row.genre,
    targetDurationMinutes: row.target_duration_minutes,
    isSystem: row.is_system,
    isPublic: row.is_public,
    templateData: row.template_data as TemplateData,
    usageCount: row.usage_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}
