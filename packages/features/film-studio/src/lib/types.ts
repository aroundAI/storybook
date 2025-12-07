// Core studio types
export type StudioWorkflowStatus =
  | 'idle'
  | 'planning'
  | 'generating'
  | 'processing'
  | 'completed'
  | 'error';

export interface StudioContext {
  projectId: string;
  episodeId?: string;
  shotId?: string;
  status: StudioWorkflowStatus;
}
