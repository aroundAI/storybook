import type { AnyStageDefinition, StageDefinition, StageKey } from './types';

/**
 * Every registered stage, by key. Registering a stage exposes it to both
 * entry points (the worker and the MCP tools) at once.
 */
export const stageRegistry = new Map<StageKey, AnyStageDefinition>();

export function registerStage<TTarget, TOut, TData>(
  stage: StageDefinition<TTarget, TOut, TData>,
): StageDefinition<TTarget, TOut, TData> {
  const existing = stageRegistry.get(stage.key);

  if (existing && existing !== stage) {
    throw new Error(`Stage ${stage.key} is already registered`);
  }

  stageRegistry.set(stage.key, stage);

  return stage;
}

export function getStage(key: StageKey): AnyStageDefinition {
  const stage = stageRegistry.get(key);

  if (!stage) {
    throw new Error(
      `Stage ${key} is not registered. Registered: ${[...stageRegistry.keys()].join(', ') || 'none'}`,
    );
  }

  return stage;
}

export function registeredStageKeys(): StageKey[] {
  return [...stageRegistry.keys()];
}
