import 'server-only';

/**
 * FILM-1909's edit tools: one scene, one shot, one dialogue line. Not in
 * `defaultTools` yet: an edit writes several rows, which must apply in one
 * transaction under a run, and that writer (FILM-1903's run layer and
 * `apply_generation_commit`, #567 and #574) is not on main. Until then the
 * tools are built and tested against an injected writer.
 */
export {
  createEditTools,
  targetChanged,
  type EditCommitRequest,
  type EditCommitResult,
  type EditToolDeps,
  type EditWriter,
} from './tools';
export {
  planLineEdit,
  planSceneEdit,
  planShotEdit,
  screenplayWithScene,
  shotColumns,
  type DialogueChange,
  type EditPlan,
  type EditStage,
  type EditWrite,
} from './plan';
