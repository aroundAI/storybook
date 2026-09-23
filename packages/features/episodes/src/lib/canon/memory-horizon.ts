/**
 * Memory horizon: how many past episodes a memory context covers.
 * FILM-1110
 *
 * Client-safe. The builder (server and LLM Lambda), the canon health
 * dashboard and the Canon settings form all decide the horizon here, so the
 * number the form shows is the number generation uses.
 */
import type { ProjectType } from '@kit/film-studio-schemas/project';

import {
  getContentTypeConfig,
  resolveProjectType,
} from './content-type-configs';

export const MIN_MEMORY_HORIZON = 1;
export const MAX_MEMORY_HORIZON = 100;

/** Last resort, when no content type supplies a horizon. */
export const DEFAULT_MEMORY_HORIZON = 10;

/**
 * Before FILM-1110 the Canon settings form saved its slider's default, 10,
 * whenever it was saved — whether or not the slider was moved. A stored 10
 * without a `memoryHorizonMode` is therefore read as "never chosen".
 */
const LEGACY_UNTOUCHED_FORM_HORIZON = 10;

export type MemoryHorizonMode = 'automatic' | 'custom';

export type MemoryHorizonSource =
  | 'argument'
  | 'canon-settings'
  | 'content-type'
  | 'default';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function clampMemoryHorizon(value: number): number {
  return Math.min(
    MAX_MEMORY_HORIZON,
    Math.max(MIN_MEMORY_HORIZON, Math.floor(value)),
  );
}

/** The horizon a content type uses when the user has not chosen one. */
export function contentTypeMemoryHorizon(projectType: ProjectType): number {
  return getContentTypeConfig(projectType).memoryHorizon;
}

/**
 * The horizon the user explicitly chose in Canon settings, if any.
 *
 * `canon` is `projects.metadata.canon`. Saves from the current form carry
 * `memoryHorizonMode`; older saves do not, and for those a stored 10 is the
 * untouched default rather than a choice.
 */
export function savedMemoryHorizonOverride(canon: unknown): number | undefined {
  if (!canon || typeof canon !== 'object') {
    return undefined;
  }

  const stored = 'memoryHorizon' in canon ? canon.memoryHorizon : undefined;
  const mode =
    'memoryHorizonMode' in canon ? canon.memoryHorizonMode : undefined;

  if (!isFiniteNumber(stored) || mode === 'automatic') {
    return undefined;
  }

  if (mode === undefined && stored === LEGACY_UNTOUCHED_FORM_HORIZON) {
    return undefined;
  }

  return clampMemoryHorizon(stored);
}

/**
 * Decides the horizon. This is the one place the precedence lives:
 * explicit argument → the user's Canon settings override → the content
 * type's horizon → `DEFAULT_MEMORY_HORIZON`.
 */
export function resolveMemoryHorizon(candidates: {
  argument?: number;
  canonOverride?: number;
  contentType?: number;
}): { memoryHorizon: number; source: MemoryHorizonSource } {
  if (isFiniteNumber(candidates.argument)) {
    return {
      memoryHorizon: clampMemoryHorizon(candidates.argument),
      source: 'argument',
    };
  }

  if (isFiniteNumber(candidates.canonOverride)) {
    return {
      memoryHorizon: clampMemoryHorizon(candidates.canonOverride),
      source: 'canon-settings',
    };
  }

  if (isFiniteNumber(candidates.contentType)) {
    return {
      memoryHorizon: clampMemoryHorizon(candidates.contentType),
      source: 'content-type',
    };
  }

  return { memoryHorizon: DEFAULT_MEMORY_HORIZON, source: 'default' };
}

/** The horizon in effect for a project, from its `projects.metadata`. */
export function effectiveMemoryHorizon(metadata: unknown) {
  const { projectType } = resolveProjectType(metadata);
  const canon =
    metadata && typeof metadata === 'object' && 'canon' in metadata
      ? metadata.canon
      : undefined;

  return resolveMemoryHorizon({
    canonOverride: savedMemoryHorizonOverride(canon),
    contentType: contentTypeMemoryHorizon(projectType),
  });
}
