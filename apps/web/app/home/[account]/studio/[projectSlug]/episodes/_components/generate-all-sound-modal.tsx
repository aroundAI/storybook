'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Loader2,
  Mic,
  Music,
  Volume2,
  XCircle,
} from 'lucide-react';

import {
  batchGenerateDialogueAction,
  generateAudioCuesAction,
  generateAudioForCueAction,
  getAudioCuesAction,
  getBatchStatusAction,
  getSeasonAudioSummaryAction,
} from '@kit/audio-generation/server';
import type { Episode } from '@kit/episodes/types';
import { Button } from '@kit/ui/button';
import { Checkbox } from '@kit/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { Progress } from '@kit/ui/progress';
import { cn } from '@kit/ui/utils';

// =============================================================================
// Types
// =============================================================================

interface AudioStats {
  dialogueTotal: number;
  dialogueCompleted: number;
  musicTotal: number;
  musicCompleted: number;
  sfxTotal: number;
  sfxCompleted: number;
}

interface EpisodeSummary {
  episodeId: string;
  episodeNumber: number;
  title: string;
  hasAudioCues: boolean;
  audioCueCount: number;
  dialogue: { total: number; completed: number; pending: number };
  music: { total: number; completed: number; pending: number };
  sfx: { total: number; completed: number; pending: number };
}

type StepName = 'cues' | 'dialogue' | 'music' | 'sfx';
type StepStatus = 'pending' | 'running' | 'completed' | 'error' | 'skipped';

interface EpisodeStep {
  status: StepStatus;
  progress: number;
  total: number;
  error?: string;
}

interface EpisodeState {
  episodeId: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  steps: Record<StepName, EpisodeStep>;
}

type Phase = 'selection' | 'running' | 'done';

interface ModalState {
  phase: Phase;
  loading: boolean;
  episodeSummaries: EpisodeSummary[];
  selectedEpisodeIds: Set<string>;
  audioTypes: { dialogue: boolean; music: boolean; sfx: boolean };
  episodeStates: Map<string, EpisodeState>;
  currentEpisodeIndex: number;
  cancelled: boolean;
  errors: Array<{ episodeId: string; step: string; message: string }>;
}

type Action =
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_SUMMARIES'; summaries: EpisodeSummary[] }
  | { type: 'TOGGLE_EPISODE'; episodeId: string }
  | { type: 'SELECT_ALL' }
  | { type: 'DESELECT_ALL' }
  | { type: 'TOGGLE_AUDIO_TYPE'; audioType: 'dialogue' | 'music' | 'sfx' }
  | { type: 'START' }
  | { type: 'EPISODE_START'; episodeId: string }
  | {
      type: 'STEP_START';
      episodeId: string;
      step: StepName;
      total: number;
    }
  | {
      type: 'STEP_PROGRESS';
      episodeId: string;
      step: StepName;
      progress: number;
    }
  | { type: 'STEP_COMPLETE'; episodeId: string; step: StepName }
  | { type: 'STEP_SKIP'; episodeId: string; step: StepName }
  | {
      type: 'STEP_ERROR';
      episodeId: string;
      step: StepName;
      error: string;
    }
  | { type: 'EPISODE_COMPLETE'; episodeId: string }
  | { type: 'NEXT_EPISODE' }
  | { type: 'CANCEL' }
  | { type: 'DONE' }
  | { type: 'RESET' };

function createInitialEpisodeState(episodeId: string): EpisodeState {
  return {
    episodeId,
    status: 'pending',
    steps: {
      cues: { status: 'pending', progress: 0, total: 0 },
      dialogue: { status: 'pending', progress: 0, total: 0 },
      music: { status: 'pending', progress: 0, total: 0 },
      sfx: { status: 'pending', progress: 0, total: 0 },
    },
  };
}

const initialState: ModalState = {
  phase: 'selection',
  loading: false,
  episodeSummaries: [],
  selectedEpisodeIds: new Set(),
  audioTypes: { dialogue: true, music: true, sfx: true },
  episodeStates: new Map(),
  currentEpisodeIndex: 0,
  cancelled: false,
  errors: [],
};

function reducer(state: ModalState, action: Action): ModalState {
  switch (action.type) {
    case 'SET_LOADING':
      return { ...state, loading: action.loading };

    case 'SET_SUMMARIES': {
      const ids = new Set(action.summaries.map((s) => s.episodeId));
      return {
        ...state,
        episodeSummaries: action.summaries,
        selectedEpisodeIds: ids,
        loading: false,
      };
    }

    case 'TOGGLE_EPISODE': {
      const next = new Set(state.selectedEpisodeIds);
      if (next.has(action.episodeId)) {
        next.delete(action.episodeId);
      } else {
        next.add(action.episodeId);
      }
      return { ...state, selectedEpisodeIds: next };
    }

    case 'SELECT_ALL':
      return {
        ...state,
        selectedEpisodeIds: new Set(
          state.episodeSummaries.map((s) => s.episodeId),
        ),
      };

    case 'DESELECT_ALL':
      return { ...state, selectedEpisodeIds: new Set() };

    case 'TOGGLE_AUDIO_TYPE':
      return {
        ...state,
        audioTypes: {
          ...state.audioTypes,
          [action.audioType]: !state.audioTypes[action.audioType],
        },
      };

    case 'START': {
      const episodeStates = new Map<string, EpisodeState>();
      for (const id of state.selectedEpisodeIds) {
        episodeStates.set(id, createInitialEpisodeState(id));
      }
      return {
        ...state,
        phase: 'running',
        episodeStates,
        currentEpisodeIndex: 0,
        cancelled: false,
        errors: [],
      };
    }

    case 'EPISODE_START': {
      const eps = new Map(state.episodeStates);
      const es = eps.get(action.episodeId);
      if (es) {
        eps.set(action.episodeId, { ...es, status: 'running' });
      }
      return { ...state, episodeStates: eps };
    }

    case 'STEP_START': {
      const eps = new Map(state.episodeStates);
      const es = eps.get(action.episodeId);
      if (es) {
        eps.set(action.episodeId, {
          ...es,
          steps: {
            ...es.steps,
            [action.step]: {
              status: 'running',
              progress: 0,
              total: action.total,
            },
          },
        });
      }
      return { ...state, episodeStates: eps };
    }

    case 'STEP_PROGRESS': {
      const eps = new Map(state.episodeStates);
      const es = eps.get(action.episodeId);
      if (es) {
        eps.set(action.episodeId, {
          ...es,
          steps: {
            ...es.steps,
            [action.step]: {
              ...es.steps[action.step as StepName],
              progress: action.progress,
            },
          },
        });
      }
      return { ...state, episodeStates: eps };
    }

    case 'STEP_COMPLETE': {
      const eps = new Map(state.episodeStates);
      const es = eps.get(action.episodeId);
      if (es) {
        const step = es.steps[action.step as StepName];
        eps.set(action.episodeId, {
          ...es,
          steps: {
            ...es.steps,
            [action.step]: {
              ...step,
              status: 'completed',
              progress: step.total,
            },
          },
        });
      }
      return { ...state, episodeStates: eps };
    }

    case 'STEP_SKIP': {
      const eps = new Map(state.episodeStates);
      const es = eps.get(action.episodeId);
      if (es) {
        eps.set(action.episodeId, {
          ...es,
          steps: {
            ...es.steps,
            [action.step]: {
              ...es.steps[action.step as StepName],
              status: 'skipped',
            },
          },
        });
      }
      return { ...state, episodeStates: eps };
    }

    case 'STEP_ERROR': {
      const eps = new Map(state.episodeStates);
      const es = eps.get(action.episodeId);
      if (es) {
        eps.set(action.episodeId, {
          ...es,
          steps: {
            ...es.steps,
            [action.step]: {
              ...es.steps[action.step as StepName],
              status: 'error',
              error: action.error,
            },
          },
        });
      }
      return {
        ...state,
        episodeStates: eps,
        errors: [
          ...state.errors,
          {
            episodeId: action.episodeId,
            step: action.step,
            message: action.error,
          },
        ],
      };
    }

    case 'EPISODE_COMPLETE': {
      const eps = new Map(state.episodeStates);
      const es = eps.get(action.episodeId);
      if (es) {
        const hasError = Object.values(es.steps).some(
          (s) => s.status === 'error',
        );
        eps.set(action.episodeId, {
          ...es,
          status: hasError ? 'error' : 'completed',
        });
      }
      return { ...state, episodeStates: eps };
    }

    case 'NEXT_EPISODE':
      return { ...state, currentEpisodeIndex: state.currentEpisodeIndex + 1 };

    case 'CANCEL':
      return { ...state, cancelled: true };

    case 'DONE':
      return { ...state, phase: 'done' };

    case 'RESET':
      return { ...initialState };

    default:
      return state;
  }
}

// =============================================================================
// Helpers
// =============================================================================

const STEP_LABELS: Record<StepName, string> = {
  cues: 'Audio Cues',
  dialogue: 'Dialogue',
  music: 'Music',
  sfx: 'SFX',
};

function StepIcon({ status }: { status: StepStatus }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-500" />;
    case 'error':
      return <XCircle className="h-3.5 w-3.5 text-red-500" />;
    case 'skipped':
      return <Check className="h-3.5 w-3.5 text-gray-400" />;
    default:
      return (
        <div className="h-3.5 w-3.5 rounded-full border border-gray-300 dark:border-gray-600" />
      );
  }
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// =============================================================================
// Component
// =============================================================================

interface GenerateAllSoundModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seasonId: string;
  seasonNumber: number;
  projectId: string;
  episodes: Episode[];
  audioStatsMap?: Map<string, AudioStats>;
}

export function GenerateAllSoundModal({
  open,
  onOpenChange,
  seasonId,
  seasonNumber,
  projectId: _projectId,
}: GenerateAllSoundModalProps) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const cancelledRef = useRef(false);

  // Keep cancelledRef in sync
  useEffect(() => {
    cancelledRef.current = state.cancelled;
  }, [state.cancelled]);

  // Fetch detailed summary when modal opens
  useEffect(() => {
    if (!open) return;
    dispatch({ type: 'RESET' });

    let mounted = true;
    (async () => {
      dispatch({ type: 'SET_LOADING', loading: true });
      try {
        const result = await getSeasonAudioSummaryAction({ seasonId });
        if (mounted && result) {
          dispatch({ type: 'SET_SUMMARIES', summaries: result.episodes });
        }
      } catch {
        if (mounted) dispatch({ type: 'SET_LOADING', loading: false });
      }
    })();

    return () => {
      mounted = false;
    };
  }, [open, seasonId]);

  // Totals for the selection phase
  const totals = useMemo(() => {
    const selected = state.episodeSummaries.filter((s) =>
      state.selectedEpisodeIds.has(s.episodeId),
    );
    return {
      episodes: selected.length,
      dialogue: selected.reduce((a, s) => a + s.dialogue.pending, 0),
      music: selected.reduce((a, s) => a + s.music.pending, 0),
      sfx: selected.reduce((a, s) => a + s.sfx.pending, 0),
      cues: selected.filter((s) => !s.hasAudioCues).length,
    };
  }, [state.episodeSummaries, state.selectedEpisodeIds]);

  // Overall progress for running phase
  const overallProgress = useMemo(() => {
    if (state.phase !== 'running' && state.phase !== 'done') return 0;
    const total = state.episodeStates.size;
    if (total === 0) return 0;
    let completed = 0;
    state.episodeStates.forEach((es) => {
      if (es.status === 'completed' || es.status === 'error') completed++;
    });
    return Math.round((completed / total) * 100);
  }, [state.phase, state.episodeStates]);

  // List of selected episode IDs in order
  const selectedEpisodes = useMemo(
    () =>
      state.episodeSummaries.filter((s) =>
        state.selectedEpisodeIds.has(s.episodeId),
      ),
    [state.episodeSummaries, state.selectedEpisodeIds],
  );

  // ---------- Generation orchestrator ----------

  const runGeneration = useCallback(async () => {
    dispatch({ type: 'START' });
    cancelledRef.current = false;

    const episodes = state.episodeSummaries.filter((s) =>
      state.selectedEpisodeIds.has(s.episodeId),
    );

    for (let i = 0; i < episodes.length; i++) {
      if (cancelledRef.current) break;

      const ep = episodes[i]!;
      dispatch({ type: 'EPISODE_START', episodeId: ep.episodeId });

      // Step 1: Audio Cues
      if (!ep.hasAudioCues) {
        dispatch({
          type: 'STEP_START',
          episodeId: ep.episodeId,
          step: 'cues',
          total: 1,
        });
        try {
          const cueResult = await generateAudioCuesAction({
            episodeId: ep.episodeId,
          });
          if (!cueResult.success) {
            dispatch({
              type: 'STEP_ERROR',
              episodeId: ep.episodeId,
              step: 'cues',
              error: cueResult.error ?? 'Failed to queue audio cue generation',
            });
          } else {
            // Wait for the LLM job to complete — poll for cues to appear
            let attempts = 0;
            const maxAttempts = 60; // ~5 min with 5s polling
            let cuesGenerated = false;

            while (attempts < maxAttempts && !cancelledRef.current) {
              await delay(5000);
              attempts++;
              try {
                const result = await getAudioCuesAction({
                  episodeId: ep.episodeId,
                });
                const cueList = result?.cues ?? [];
                if (cueList.length > 0) {
                  cuesGenerated = true;
                  ep.hasAudioCues = true;
                  ep.audioCueCount = cueList.length;
                  ep.music.total = cueList.filter(
                    (c) => c.cue_type === 'music',
                  ).length;
                  ep.sfx.total = cueList.filter(
                    (c) => c.cue_type === 'sfx' || c.cue_type === 'ambient',
                  ).length;
                  ep.music.pending = ep.music.total;
                  ep.sfx.pending = ep.sfx.total;
                  break;
                }
              } catch {
                // polling error — continue
              }
            }

            if (cuesGenerated) {
              dispatch({
                type: 'STEP_COMPLETE',
                episodeId: ep.episodeId,
                step: 'cues',
              });
            } else if (!cancelledRef.current) {
              dispatch({
                type: 'STEP_ERROR',
                episodeId: ep.episodeId,
                step: 'cues',
                error: 'Timed out waiting for audio cues to generate',
              });
            }
          }
        } catch (err) {
          dispatch({
            type: 'STEP_ERROR',
            episodeId: ep.episodeId,
            step: 'cues',
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      } else {
        dispatch({ type: 'STEP_SKIP', episodeId: ep.episodeId, step: 'cues' });
      }

      if (cancelledRef.current) break;

      // Step 2: Dialogue
      if (state.audioTypes.dialogue && ep.dialogue.pending > 0) {
        dispatch({
          type: 'STEP_START',
          episodeId: ep.episodeId,
          step: 'dialogue',
          total: ep.dialogue.pending,
        });
        try {
          const batchResult = await batchGenerateDialogueAction({
            episodeId: ep.episodeId,
          });

          if (batchResult.batchJobId) {
            // Poll batch status
            let done = false;
            while (!done && !cancelledRef.current) {
              await delay(3000);
              try {
                const status = await getBatchStatusAction({
                  batchJobId: batchResult.batchJobId,
                });
                dispatch({
                  type: 'STEP_PROGRESS',
                  episodeId: ep.episodeId,
                  step: 'dialogue',
                  progress: status.progress.completed,
                });
                if (
                  status.status === 'completed' ||
                  status.status === 'failed'
                ) {
                  done = true;
                  if (status.progress.failed > 0) {
                    dispatch({
                      type: 'STEP_ERROR',
                      episodeId: ep.episodeId,
                      step: 'dialogue',
                      error: `${status.progress.failed} lines failed`,
                    });
                  } else {
                    dispatch({
                      type: 'STEP_COMPLETE',
                      episodeId: ep.episodeId,
                      step: 'dialogue',
                    });
                  }
                }
              } catch {
                // Polling failed — will retry
              }
            }
          }
        } catch (err) {
          dispatch({
            type: 'STEP_ERROR',
            episodeId: ep.episodeId,
            step: 'dialogue',
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      } else {
        dispatch({
          type: 'STEP_SKIP',
          episodeId: ep.episodeId,
          step: 'dialogue',
        });
      }

      if (cancelledRef.current) break;

      // Step 3: Music
      if (state.audioTypes.music && ep.music.pending > 0) {
        dispatch({
          type: 'STEP_START',
          episodeId: ep.episodeId,
          step: 'music',
          total: ep.music.pending,
        });
        try {
          // Get the actual pending cues
          const musicResult = await getAudioCuesAction({
            episodeId: ep.episodeId,
          });
          const pendingMusic = (musicResult?.cues ?? []).filter(
            (c) =>
              c.cue_type === 'music' &&
              c.status !== 'placed' &&
              c.status !== 'matched',
          );

          let completed = 0;
          for (const cue of pendingMusic) {
            if (cancelledRef.current) break;
            try {
              await generateAudioForCueAction({ cueId: cue.id });
              completed++;
              dispatch({
                type: 'STEP_PROGRESS',
                episodeId: ep.episodeId,
                step: 'music',
                progress: completed,
              });
              // Delay between requests to respect rate limits (20 req/min for music)
              await delay(3000);
            } catch {
              // Individual cue failure — continue with next
            }
          }

          dispatch({
            type: 'STEP_COMPLETE',
            episodeId: ep.episodeId,
            step: 'music',
          });
        } catch (err) {
          dispatch({
            type: 'STEP_ERROR',
            episodeId: ep.episodeId,
            step: 'music',
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      } else {
        dispatch({
          type: 'STEP_SKIP',
          episodeId: ep.episodeId,
          step: 'music',
        });
      }

      if (cancelledRef.current) break;

      // Step 4: SFX
      if (state.audioTypes.sfx && ep.sfx.pending > 0) {
        dispatch({
          type: 'STEP_START',
          episodeId: ep.episodeId,
          step: 'sfx',
          total: ep.sfx.pending,
        });
        try {
          const sfxResult = await getAudioCuesAction({
            episodeId: ep.episodeId,
          });
          const pendingSfx = (sfxResult?.cues ?? []).filter(
            (c) =>
              (c.cue_type === 'sfx' || c.cue_type === 'ambient') &&
              c.status !== 'placed' &&
              c.status !== 'matched',
          );

          let completed = 0;
          for (const cue of pendingSfx) {
            if (cancelledRef.current) break;
            try {
              await generateAudioForCueAction({ cueId: cue.id });
              completed++;
              dispatch({
                type: 'STEP_PROGRESS',
                episodeId: ep.episodeId,
                step: 'sfx',
                progress: completed,
              });
              // Delay between requests to respect rate limits (30 req/min for SFX)
              await delay(2000);
            } catch {
              // Individual cue failure — continue
            }
          }

          dispatch({
            type: 'STEP_COMPLETE',
            episodeId: ep.episodeId,
            step: 'sfx',
          });
        } catch (err) {
          dispatch({
            type: 'STEP_ERROR',
            episodeId: ep.episodeId,
            step: 'sfx',
            error: err instanceof Error ? err.message : 'Unknown error',
          });
        }
      } else {
        dispatch({
          type: 'STEP_SKIP',
          episodeId: ep.episodeId,
          step: 'sfx',
        });
      }

      dispatch({ type: 'EPISODE_COMPLETE', episodeId: ep.episodeId });
      dispatch({ type: 'NEXT_EPISODE' });
    }

    dispatch({ type: 'DONE' });
  }, [state.episodeSummaries, state.selectedEpisodeIds, state.audioTypes]);

  // ---------- Render ----------

  const allSelected =
    state.selectedEpisodeIds.size === state.episodeSummaries.length;
  const noneSelected = state.selectedEpisodeIds.size === 0;
  const anyTypeSelected =
    state.audioTypes.dialogue || state.audioTypes.music || state.audioTypes.sfx;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && state.phase === 'running') return; // prevent close during generation
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Volume2 className="h-5 w-5 text-violet-500" />
            Generate All Sound — Season {seasonNumber}
          </DialogTitle>
          <DialogDescription>
            {state.phase === 'selection' &&
              'Select episodes and audio types to generate.'}
            {state.phase === 'running' && 'Processing episodes sequentially…'}
            {state.phase === 'done' && 'Generation complete.'}
          </DialogDescription>
        </DialogHeader>

        {/* ────── PHASE 1: Selection ────── */}
        {state.phase === 'selection' && (
          <div className="space-y-4">
            {state.loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
                <span className="ml-3 text-sm text-gray-500">
                  Loading episode data…
                </span>
              </div>
            ) : (
              <>
                {/* Audio type toggles */}
                <div className="flex items-center gap-4 rounded-lg border border-white/10 bg-white/[0.03] p-3">
                  <span className="text-xs font-medium text-gray-400">
                    Generate:
                  </span>
                  {(['dialogue', 'music', 'sfx'] as const).map((t) => (
                    <label
                      key={t}
                      className="flex cursor-pointer items-center gap-1.5 text-xs"
                    >
                      <Checkbox
                        checked={state.audioTypes[t]}
                        onCheckedChange={() =>
                          dispatch({ type: 'TOGGLE_AUDIO_TYPE', audioType: t })
                        }
                      />
                      <span className="text-gray-300 capitalize">{t}</span>
                    </label>
                  ))}
                </div>

                {/* Select All / Deselect All */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">
                    {state.selectedEpisodeIds.size} of{' '}
                    {state.episodeSummaries.length} episodes selected
                  </span>
                  <div className="flex gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => dispatch({ type: 'SELECT_ALL' })}
                      disabled={allSelected}
                    >
                      Select All
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => dispatch({ type: 'DESELECT_ALL' })}
                      disabled={noneSelected}
                    >
                      Deselect All
                    </Button>
                  </div>
                </div>

                {/* Episode list */}
                <div className="max-h-[40vh] space-y-1 overflow-y-auto pr-1">
                  {state.episodeSummaries.map((ep) => {
                    const selected = state.selectedEpisodeIds.has(ep.episodeId);
                    return (
                      <label
                        key={ep.episodeId}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 transition-colors',
                          selected
                            ? 'border-violet-500/30 bg-violet-500/5'
                            : 'border-white/5 bg-white/[0.02] hover:bg-white/[0.04]',
                        )}
                      >
                        <Checkbox
                          checked={selected}
                          onCheckedChange={() =>
                            dispatch({
                              type: 'TOGGLE_EPISODE',
                              episodeId: ep.episodeId,
                            })
                          }
                        />
                        <span className="w-7 text-right text-xs text-gray-500 tabular-nums">
                          #{String(ep.episodeNumber).padStart(2, '0')}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-sm text-gray-200">
                          {ep.title}
                        </span>
                        <div className="flex items-center gap-2 text-[10px] text-gray-500 tabular-nums">
                          <span className="flex items-center gap-0.5">
                            <Mic className="h-3 w-3" />
                            {ep.dialogue.completed}/{ep.dialogue.total}
                          </span>
                          <span className="flex items-center gap-0.5">
                            <Music className="h-3 w-3" />
                            {ep.music.completed}/{ep.music.total}
                          </span>
                          <span className="flex items-center gap-0.5">
                            <Volume2 className="h-3 w-3" />
                            {ep.sfx.completed}/{ep.sfx.total}
                          </span>
                        </div>
                      </label>
                    );
                  })}
                </div>

                {/* Summary footer */}
                <div className="rounded-lg border border-dashed border-white/10 bg-white/[0.02] px-4 py-3 text-xs text-gray-400">
                  Will generate across {totals.episodes} episodes:{' '}
                  {totals.cues > 0 && (
                    <span className="text-violet-400">
                      {totals.cues} audio cue sets
                    </span>
                  )}
                  {totals.cues > 0 && totals.dialogue > 0 && ' · '}
                  {state.audioTypes.dialogue && totals.dialogue > 0 && (
                    <span className="text-blue-400">
                      {totals.dialogue} dialogue lines
                    </span>
                  )}
                  {state.audioTypes.dialogue &&
                    totals.dialogue > 0 &&
                    state.audioTypes.music &&
                    totals.music > 0 &&
                    ' · '}
                  {state.audioTypes.music && totals.music > 0 && (
                    <span className="text-purple-400">
                      {totals.music} music cues
                    </span>
                  )}
                  {state.audioTypes.music &&
                    totals.music > 0 &&
                    state.audioTypes.sfx &&
                    totals.sfx > 0 &&
                    ' · '}
                  {state.audioTypes.sfx && totals.sfx > 0 && (
                    <span className="text-amber-400">
                      {totals.sfx} SFX cues
                    </span>
                  )}
                </div>
              </>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={runGeneration}
                disabled={noneSelected || !anyTypeSelected || state.loading}
                className="gap-2 bg-gradient-to-r from-violet-600 to-purple-600 text-white hover:from-violet-700 hover:to-purple-700"
              >
                <Volume2 className="h-4 w-4" />
                Start Generation
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ────── PHASE 2: Running ────── */}
        {state.phase === 'running' && (
          <div className="space-y-4">
            {/* Overall progress */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-300">
                  Episode{' '}
                  {Math.min(
                    state.currentEpisodeIndex + 1,
                    selectedEpisodes.length,
                  )}{' '}
                  of {selectedEpisodes.length}
                </span>
                <span className="text-gray-500 tabular-nums">
                  {overallProgress}%
                </span>
              </div>
              <Progress value={overallProgress} className="h-2" />
            </div>

            {/* Per-episode status */}
            <div className="max-h-[45vh] space-y-2 overflow-y-auto pr-1">
              {selectedEpisodes.map((ep) => {
                const es = state.episodeStates.get(ep.episodeId);
                if (!es) return null;

                return (
                  <div
                    key={ep.episodeId}
                    className={cn(
                      'rounded-lg border p-3 transition-colors',
                      es.status === 'running'
                        ? 'border-violet-500/30 bg-violet-500/5'
                        : es.status === 'completed'
                          ? 'border-green-500/20 bg-green-500/5'
                          : es.status === 'error'
                            ? 'border-red-500/20 bg-red-500/5'
                            : 'border-white/5 bg-white/[0.02]',
                    )}
                  >
                    <div className="mb-2 flex items-center gap-2">
                      {es.status === 'completed' && (
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      )}
                      {es.status === 'running' && (
                        <Loader2 className="h-4 w-4 animate-spin text-violet-500" />
                      )}
                      {es.status === 'error' && (
                        <AlertTriangle className="h-4 w-4 text-red-500" />
                      )}
                      {es.status === 'pending' && (
                        <div className="h-4 w-4 rounded-full border border-gray-600" />
                      )}
                      <span
                        className={cn(
                          'text-sm font-medium',
                          es.status === 'pending'
                            ? 'text-gray-500'
                            : 'text-gray-200',
                        )}
                      >
                        #{String(ep.episodeNumber).padStart(2, '0')} {ep.title}
                      </span>
                    </div>

                    {/* Step details for current/completed episodes */}
                    {es.status !== 'pending' && (
                      <div className="ml-6 grid grid-cols-4 gap-2">
                        {(['cues', 'dialogue', 'music', 'sfx'] as const).map(
                          (step) => {
                            const s = es.steps[step];
                            return (
                              <div
                                key={step}
                                className="flex items-center gap-1.5 text-[10px]"
                              >
                                <StepIcon status={s.status} />
                                <span
                                  className={cn(
                                    s.status === 'running'
                                      ? 'text-blue-400'
                                      : s.status === 'completed'
                                        ? 'text-green-400'
                                        : s.status === 'error'
                                          ? 'text-red-400'
                                          : 'text-gray-500',
                                  )}
                                >
                                  {STEP_LABELS[step]}
                                  {s.status === 'running' &&
                                    s.total > 0 &&
                                    ` ${s.progress}/${s.total}`}
                                </span>
                              </div>
                            );
                          },
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => dispatch({ type: 'CANCEL' })}
                disabled={state.cancelled}
                className="gap-2 border-orange-200 text-orange-600 hover:bg-orange-50 dark:border-orange-800 dark:text-orange-400 dark:hover:bg-orange-950"
              >
                {state.cancelled ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Cancelling…
                  </>
                ) : (
                  'Cancel'
                )}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* ────── PHASE 3: Done ────── */}
        {state.phase === 'done' && (
          <div className="space-y-4">
            {/* Summary stats */}
            <div className="rounded-lg border border-green-500/20 bg-green-500/5 p-4">
              <div className="mb-2 flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <span className="font-medium text-gray-200">
                  {state.cancelled
                    ? 'Generation cancelled'
                    : 'Generation complete'}
                </span>
              </div>
              <div className="flex gap-4 text-sm text-gray-400">
                {(() => {
                  let completed = 0;
                  let errored = 0;
                  state.episodeStates.forEach((es) => {
                    if (es.status === 'completed') completed++;
                    if (es.status === 'error') errored++;
                  });
                  return (
                    <>
                      <span className="text-green-400">
                        ✅ {completed} episodes completed
                      </span>
                      {errored > 0 && (
                        <span className="text-red-400">
                          ⚠️ {errored} with errors
                        </span>
                      )}
                    </>
                  );
                })()}
              </div>
            </div>

            {/* Error details */}
            {state.errors.length > 0 && (
              <div className="max-h-[30vh] space-y-1 overflow-y-auto">
                <p className="text-xs font-medium text-gray-400">
                  Errors ({state.errors.length}):
                </p>
                {state.errors.map((err, i) => {
                  const ep = state.episodeSummaries.find(
                    (s) => s.episodeId === err.episodeId,
                  );
                  return (
                    <div
                      key={i}
                      className="rounded border border-red-500/10 bg-red-500/5 px-3 py-2 text-xs text-red-300"
                    >
                      <span className="font-medium">
                        #{ep?.episodeNumber ?? '?'} {ep?.title ?? 'Unknown'}
                      </span>
                      {' · '}
                      {err.step}: {err.message}
                    </div>
                  );
                })}
              </div>
            )}

            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
