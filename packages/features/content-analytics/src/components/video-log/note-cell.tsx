'use client';

import { useRef, useState } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';
import { useForm } from 'react-hook-form';

import { Button } from '@kit/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { Popover, PopoverContent, PopoverTrigger } from '@kit/ui/popover';
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';

import { unwrap } from '../../lib/action-result';
import { localDateOf } from '../../lib/local-date';
import {
  PUBLISH_NOTE_MAX_LENGTH,
  PublishNoteFormSchema,
} from '../../lib/schemas/publish-note.schema';
import { updatePublishNoteAction } from '../../server/publish-notes-actions';

export interface NoteCellProps {
  publishId: string;
  /** The video's title, to name the note to assistive technology. */
  title: string;
  note: string | null;
  /** When the note last changed, exactly as the server sent it. */
  updatedAt: string | null;
  /** The `publishes_update` rule, from the server. */
  canEdit: boolean;
  onSaved: (saved: { note: string | null; updatedAt: string | null }) => void;
  /** The server refused: the caller can no longer edit this video's notes. */
  onPermissionLost: () => void;
}

/**
 * A video's analytics note (FILM-1610's column, FILM-1615's editor).
 *
 * Read-only unless the server says the caller may edit it. Editing happens
 * in a popover so the row stays in view; a click outside while the text has
 * changed does not close it, so typing is never lost to a stray click —
 * Cancel and Escape discard on purpose.
 */
export function NoteCell(props: NoteCellProps) {
  const { note, canEdit, title } = props;
  const [open, setOpen] = useState(false);
  // Counts openings, and keys the editor, so each one is a new editor
  // holding the note as it stands now. Radix keeps the content mounted for
  // a moment after it closes, so a popover reopened quickly — which is what
  // saving and immediately correcting a note looks like — would otherwise
  // be the *same* editor, still holding the text and the version it first
  // opened with. Saving that sends a version the note no longer has, and
  // the save comes back as someone else's edit.
  const [session, setSession] = useState(0);
  const dirty = useRef(false);

  if (!canEdit) {
    return note ? (
      <span
        className={'line-clamp-2 max-w-64 whitespace-pre-wrap'}
        title={note}
        data-test={'note-readonly'}
      >
        {note}
      </span>
    ) : (
      <span className={'text-muted-foreground'} data-test={'note-readonly'}>
        —
      </span>
    );
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (next) {
          setSession((count) => count + 1);
        } else {
          dirty.current = false;
        }
      }}
    >
      <PopoverTrigger asChild>
        <button
          type={'button'}
          className={
            'max-w-64 rounded px-1 text-left hover:bg-accent focus-visible:outline-2'
          }
          aria-label={`${note ? 'Edit' : 'Add'} note for ${title || 'Untitled'}`}
          data-test={'note-edit'}
        >
          {note ? (
            <span className={'line-clamp-2 whitespace-pre-wrap'}>{note}</span>
          ) : (
            <span className={'text-muted-foreground'}>Add note</span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        className={'w-96'}
        align={'start'}
        onInteractOutside={(event) => {
          if (dirty.current) event.preventDefault();
        }}
      >
        <NoteEditor
          key={session}
          {...props}
          onDirtyChange={(value) => {
            dirty.current = value;
          }}
          onDone={() => {
            dirty.current = false;
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** What the editor is showing besides the text: a conflict or an error. */
type EditorNotice =
  | { kind: 'none' }
  | { kind: 'conflict'; note: string | null }
  | { kind: 'error'; message: string };

function NoteEditor({
  publishId,
  title,
  note,
  updatedAt,
  onSaved,
  onPermissionLost,
  onDirtyChange,
  onDone,
}: NoteCellProps & {
  onDirtyChange: (dirty: boolean) => void;
  onDone: () => void;
}) {
  const form = useForm({
    resolver: zodResolver(PublishNoteFormSchema),
    defaultValues: { note: note ?? '' },
  });

  // The version the next save is conditional on. It moves to the other
  // edit's version when a conflict is shown, so saving again replaces
  // their note deliberately rather than silently.
  const expected = useRef(updatedAt);
  // Two clicks can land before React re-renders the disabled button.
  const inFlight = useRef(false);
  const [notice, setNotice] = useState<EditorNotice>({ kind: 'none' });

  const text = form.watch('note') ?? '';

  const submit = form.handleSubmit(async (values) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setNotice({ kind: 'none' });

    try {
      const result = await unwrap(
        updatePublishNoteAction({
          publishId,
          note: values.note ?? '',
          expectedUpdatedAt: expected.current,
        }),
      );

      if (result.status === 'conflict') {
        expected.current = result.updatedAt;
        setNotice({ kind: 'conflict', note: result.note });
        return;
      }

      toast.success(result.note ? 'Note saved' : 'Note removed');
      onSaved({ note: result.note, updatedAt: result.updatedAt });
      onDone();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not save the note.';

      setNotice({ kind: 'error', message });

      if (message.startsWith('You cannot edit notes')) {
        toast.error(message);
        onPermissionLost();
        onDone();
      }
    } finally {
      inFlight.current = false;
    }
  });

  const saving = form.formState.isSubmitting;

  return (
    <Form {...form}>
      <form
        onSubmit={submit}
        className={'flex flex-col gap-3'}
        data-test={'note-editor'}
      >
        <FormField
          control={form.control}
          name={'note'}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Note for {title || 'Untitled'}</FormLabel>
              <FormControl>
                <Textarea
                  rows={5}
                  autoFocus
                  data-test={'note-input'}
                  {...field}
                  value={field.value ?? ''}
                  onChange={(event) => {
                    field.onChange(event);
                    onDirtyChange(event.target.value !== (note ?? ''));
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === 'Enter' &&
                      (event.metaKey || event.ctrlKey)
                    ) {
                      event.preventDefault();
                      void submit();
                    }
                  }}
                />
              </FormControl>
              <div className={'flex justify-between text-xs'}>
                <span className={'text-muted-foreground'}>
                  {updatedAt ? `Last edited ${localDateOf(updatedAt)}` : ''}
                </span>
                <span
                  className={
                    text.length > PUBLISH_NOTE_MAX_LENGTH
                      ? 'text-destructive'
                      : 'text-muted-foreground'
                  }
                  data-test={'note-count'}
                >
                  {text.length.toLocaleString('en-US')} / 5,000
                </span>
              </div>
              <FormMessage />
            </FormItem>
          )}
        />

        {notice.kind === 'conflict' ? (
          <div
            className={'flex flex-col gap-2 rounded bg-muted p-2 text-sm'}
            role={'alert'}
            data-test={'note-conflict'}
          >
            <p>
              Someone else changed this note since you opened it. Saving again
              will replace their note with yours.
            </p>
            <p className={'whitespace-pre-wrap italic'}>
              {notice.note ?? '(They removed the note.)'}
            </p>
            <Button
              type={'button'}
              variant={'outline'}
              size={'sm'}
              className={'self-start'}
              data-test={'note-use-theirs'}
              onClick={() => {
                form.reset({ note: notice.note ?? '' });
                onDirtyChange(false);
                setNotice({ kind: 'none' });
              }}
            >
              Use theirs
            </Button>
          </div>
        ) : null}

        {notice.kind === 'error' ? (
          <p
            className={'text-sm text-destructive'}
            role={'alert'}
            data-test={'note-error'}
          >
            {notice.message}
          </p>
        ) : null}

        <div className={'flex justify-end gap-2'}>
          <Button
            type={'button'}
            variant={'ghost'}
            onClick={onDone}
            data-test={'note-cancel'}
          >
            Cancel
          </Button>
          <Button type={'submit'} disabled={saving} data-test={'note-save'}>
            {saving ? (
              <Loader2 className={'mr-2 h-4 w-4 animate-spin'} />
            ) : null}
            Save
          </Button>
        </div>
      </form>
    </Form>
  );
}
