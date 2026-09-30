'use client';

import { useCallback, useState, useTransition } from 'react';

import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';

import { getStateDeltasAction } from '@kit/episodes/server';

import {
  type CharacterDelta,
  characterHistory,
  describeStateValue,
  rollbackableDeltaId,
} from './character-history';
import { RollbackStateDialog } from './rollback-state-dialog';

interface CharacterStateHistoryProps {
  characterId: string;
  characterName: string;
  episodeId: string;
  onRolledBack: () => void;
}

type HistoryState =
  | { phase: 'closed' }
  | { phase: 'open'; history: CharacterDelta[] | null; failed: boolean };

/**
 * This episode's recorded changes to one character, with a Rollback on the
 * newest one. It reads the audit log when opened, and again after a rollback.
 */
export function CharacterStateHistory({
  characterId,
  characterName,
  episodeId,
  onRolledBack,
}: CharacterStateHistoryProps) {
  const [state, setState] = useState<HistoryState>({ phase: 'closed' });
  const [isPending, startTransition] = useTransition();

  const load = useCallback(() => {
    startTransition(async () => {
      const result = await getStateDeltasAction({ episodeId });

      setState(
        Array.isArray(result)
          ? {
              phase: 'open',
              history: characterHistory(result, characterId),
              failed: false,
            }
          : { phase: 'open', history: null, failed: true },
      );
    });
  }, [episodeId, characterId]);

  const toggle = () => {
    if (state.phase === 'open') {
      setState({ phase: 'closed' });
      return;
    }

    setState({ phase: 'open', history: null, failed: false });
    load();
  };

  const handleRolledBack = () => {
    load();
    onRolledBack();
  };

  const history = state.phase === 'open' ? state.history : null;
  const rollbackId = history ? rollbackableDeltaId(history) : null;

  return (
    <div className="mt-1.5" data-test="canon-character-history">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={state.phase === 'open'}
        className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
        data-test="canon-character-history-toggle"
      >
        {state.phase === 'open' ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        History
      </button>

      {state.phase === 'open' && (
        <div className="mt-1.5 space-y-1.5">
          {isPending && !history && (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}

          {state.failed && (
            <p
              className="text-[10px] text-destructive"
              data-test="canon-character-history-error"
            >
              Could not load the history.
            </p>
          )}

          {history?.length === 0 && (
            <p
              className="text-[10px] text-muted-foreground"
              data-test="canon-character-history-empty"
            >
              No changes recorded in this episode.
            </p>
          )}

          {history?.map((delta) => (
            <div
              key={delta.id}
              className="flex items-start gap-2 rounded border border-border/50 p-1.5"
              data-test="canon-character-delta"
            >
              <div className="min-w-0 flex-1 text-[10px] leading-snug">
                <p>
                  <span className="text-muted-foreground">
                    {describeStateValue(delta.before_state)}
                  </span>
                  {' -> '}
                  <span className="font-medium">
                    {describeStateValue(delta.after_state)}
                  </span>
                </p>
                {delta.change_reason && (
                  <p className="text-muted-foreground/70">
                    {delta.change_reason}
                  </p>
                )}
              </div>
              {delta.id === rollbackId && (
                <RollbackStateDialog
                  deltaId={delta.id}
                  characterName={characterName}
                  currentState={describeStateValue(delta.after_state)}
                  restoredState={describeStateValue(delta.before_state)}
                  onRolledBack={handleRolledBack}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
