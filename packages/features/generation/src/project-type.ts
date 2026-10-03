/**
 * The project type a stage prepares for, read from `projects.metadata`.
 * Moved here from `@kit/episodes/lib/canon/content-type-configs.ts`
 * (FILM-1901), which re-exports it: the season stages decide from it
 * whether the project's verified facts go into the prompt (KB-71).
 */
import {
  type ProjectType,
  ProjectTypeSchema,
} from '@kit/film-studio-schemas/project';

/** The type a project is treated as when its metadata names none. */
export const DEFAULT_PROJECT_TYPE: ProjectType = 'series';

export type ProjectTypeSource = 'argument' | 'metadata' | 'default';

/**
 * Reads the project type from `projects.metadata`, the authoritative field.
 *
 * The column is untyped JSONB, so the value is validated rather than cast:
 * anything outside `ProjectTypeSchema` falls back to `DEFAULT_PROJECT_TYPE`.
 */
export function resolveProjectType(metadata: unknown): {
  projectType: ProjectType;
  source: Exclude<ProjectTypeSource, 'argument'>;
} {
  const stored =
    metadata && typeof metadata === 'object' && 'projectType' in metadata
      ? metadata.projectType
      : undefined;

  const parsed = ProjectTypeSchema.safeParse(stored);

  return parsed.success
    ? { projectType: parsed.data, source: 'metadata' }
    : { projectType: DEFAULT_PROJECT_TYPE, source: 'default' };
}

/**
 * The types whose generation is driven by verified facts. Must agree with
 * `requiresFacts` in `@kit/episodes`' content-type configs; a test there
 * holds the two together.
 */
export const FACT_DRIVEN_PROJECT_TYPES: readonly ProjectType[] = [
  'documentary',
  'educational',
  'news',
];

export function requiresVerifiedFacts(projectType: ProjectType): boolean {
  return FACT_DRIVEN_PROJECT_TYPES.includes(projectType);
}
