import type { Tables } from '@kit/supabase/database';

export type Project = Tables<'projects'>;
export type ProjectMember = Tables<'project_members'>;

export type ProjectRole = 'owner' | 'admin' | 'member' | 'viewer';
export type ProjectAction =
  | 'project.view'
  | 'project.edit'
  | 'project.delete'
  | 'project.members.view'
  | 'project.members.add'
  | 'project.members.remove'
  | 'project.settings.view'
  | 'project.settings.edit';

export type ProjectStatus = 'active' | 'archived' | 'deleted';

export interface ProjectWithRole extends Project {
  user_role: ProjectRole | null;
}

export interface ProjectMemberWithUser extends ProjectMember {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    picture_url: string | null;
  };
}

export interface CreateProjectParams {
  account_id: string;
  name: string;
  description?: string;
  slug?: string;
  metadata?: Record<string, unknown>;
}

export interface UpdateProjectParams {
  id: string;
  name?: string;
  description?: string | null;
  slug?: string;
  status?: ProjectStatus;
  metadata?: Record<string, unknown>;
}

export interface AddProjectMemberParams {
  project_id: string;
  user_id: string;
  role: ProjectRole;
}

export interface UpdateProjectMemberParams {
  project_id: string;
  user_id: string;
  role: ProjectRole;
}

export interface RemoveProjectMemberParams {
  project_id: string;
  user_id: string;
}
