/**
 * Importing this module registers every stage. Each stage file calls
 * `registerStage` at load; `@kit/generation` re-exports them, so a caller
 * that imports the package sees the registry filled.
 */
export {};
