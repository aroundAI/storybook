import 'server-only';

import { ActionRefusal } from '@kit/next/action-result';

/**
 * The edit suite's SECURITY DEFINER functions refuse a caller who cannot
 * write the episode's project (`public.can_write_project`, KB-28) with
 * SQLSTATE 42501. This turns that refusal into one the page can show as
 * written, in one wording for every edit-suite write (KB-40, KB-62).
 *
 * `what` completes the sentence: "…can assemble its timeline." Any other
 * error returns, for the caller to throw as it did before.
 */
export function throwIfWriteRefused(
  error: { code?: string } | null | undefined,
  what: string,
): void {
  if (error?.code === '42501') {
    throw new ActionRefusal(
      `Only the project's owner, admins and members can ${what}.`,
    );
  }
}
