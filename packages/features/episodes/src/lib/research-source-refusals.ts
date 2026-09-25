/**
 * What the research-source actions return when a rule says no (KB-37). Kept
 * out of the `'use server'` actions file, where every export must be an
 * action; pure, so a client component may import it too.
 */

export const PROJECT_SOURCE_REFUSAL =
  'You can only add sources to a project you work on.';

export const TEAM_SOURCE_REFUSAL =
  'Only team owners can add team-wide sources.';

export const SOURCE_EXISTS_REFUSAL =
  'A source with that name already exists here.';

export const SOURCE_REMOVE_REFUSAL = "You can't remove this source.";
