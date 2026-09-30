/**
 * What a user reads when linking or unlinking a fact is refused (KB-48).
 *
 * The rule is episode_facts' RLS: the caller writes to the episode's project
 * (owner, admin or member) and the fact belongs to that same project.
 */
export const EPISODE_FACT_REFUSALS = {
  link: "These facts can't be linked: only facts from this episode's project can be, by someone who can edit it.",
  unlink:
    "This fact wasn't unlinked: it is no longer linked, or you can't edit this project. Reload the page.",
  scene:
    "That scene isn't in this episode's screenplay. Pick one of its scenes, or link without one.",
} as const;
