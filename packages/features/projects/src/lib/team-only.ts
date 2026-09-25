/**
 * What `kit.require_team_account` says when a project, or any workspace row,
 * names a personal account (KB-99). The database holds the rule; this is its
 * sentence, for callers that return it as a value (KB-6). The migration
 * raises the same words, and `project-mutations.test.ts` binds the two.
 */
export const TEAM_ONLY =
  'Projects and workspace data belong to a team. Choose a team, or create one, first.';

/** Postgres `check_violation`, the code the trigger raises. */
export const TEAM_ONLY_CODE = '23514';
