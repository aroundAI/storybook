import { z } from 'zod';

export const CompilationTypeEnum = z.enum([
  'best_of',
  'recap',
  'character_reel',
  'top_moments',
  'season_finale',
  'custom',
]);

export type CompilationType = z.infer<typeof CompilationTypeEnum>;

export interface Compilation {
  id: string;
  projectId: string;
  accountId: string;
  title: string;
  description: string | null;
  compilationType: CompilationType;
  seasonId: string | null;
  status: 'draft' | 'assembling' | 'rendering' | 'rendered' | 'published' | 'archived';
  outputUrl: string | null;
  thumbnailUrl: string | null;
  durationSeconds: number | null;
  editProjectId: string | null;
  chapters: ChapterMarker[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CompilationSegment {
  id: string;
  compilationId: string;
  sourceEpisodeId: string;
  sourceShotId: string | null;
  title: string | null;
  sequenceNumber: number;
  startSeconds: number;
  endSeconds: number | null;
  durationSeconds: number | null;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  transitionType: 'cut' | 'crossfade' | 'fade_black' | 'fade_white' | 'dissolve';
  transitionDurationMs: number;
  isChapterStart: boolean;
  chapterTitle: string | null;
  metadata: Record<string, unknown>;
}

export interface ChapterMarker {
  title: string;
  startSeconds: number;
}
