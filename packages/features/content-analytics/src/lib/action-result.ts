/**
 * Moved to `@kit/next/action-result` (KB-6), where `enhanceAction` lives, so
 * every feature returns refusals the same way. Re-exported so FILM-1610's
 * call sites keep their import.
 */
export {
  ActionRefusal,
  type ActionResult,
  refusalMessage,
  unwrap,
} from '@kit/next/action-result';
