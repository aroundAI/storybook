import { format } from 'date-fns';
import { MonitorPlay } from 'lucide-react';

import { isEditingInStudio, parseEditState } from '@kit/desktop-integration';
import { cn } from '@kit/ui/utils';

/**
 * FILM-2002: "Editing in Studio by <name> since <time>", shown while an
 * episode is editing and a StorybookStudio session is open. The episode
 * header (from the open session) and the episode list (from edit_state,
 * which changes in the same transaction) use the same chip.
 */
export interface EditingInStudio {
  editorName: string | null;
  /** ISO 8601 */
  since: string;
}

/** The chip's data, or null when the episode is not being edited in the Studio. */
export function editingInStudioOf(episode: {
  status: string;
  edit_state: unknown;
}): EditingInStudio | null {
  if (!isEditingInStudio(episode)) return null;

  const editState = parseEditState(episode.edit_state);

  return editState.since
    ? { editorName: editState.editedBy?.name ?? null, since: editState.since }
    : null;
}

export function EditingInStudioBadge({
  editing,
  className,
}: {
  editing: EditingInStudio;
  className?: string;
}) {
  const since = new Date(editing.since);
  const editor = editing.editorName ?? 'a teammate';

  return (
    <span
      data-test="editing-in-studio-badge"
      title={`Being edited in StorybookStudio by ${editor} since ${since.toISOString()}`}
      className={cn(
        'inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-900 dark:bg-amber-900/30 dark:text-amber-200',
        className,
      )}
    >
      <MonitorPlay className="h-2.5 w-2.5" aria-hidden="true" />
      <span>
        Editing in Studio by{' '}
        <span data-test="editing-in-studio-editor">{editor}</span> since{' '}
        <time dateTime={editing.since} suppressHydrationWarning>
          {format(since, 'MMM d, h:mm a')}
        </time>
      </span>
    </span>
  );
}
