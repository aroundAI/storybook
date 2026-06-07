'use client';

import { useCallback, useReducer, useRef } from 'react';

import { Wand2 } from 'lucide-react';

import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { Progress } from '@kit/ui/progress';
import { cn } from '@kit/ui/utils';

import type { Episode } from '@kit/episodes/types';

import { SelectionPhase } from './bulk-generate/selection-phase';
import { IdeationPhase } from './bulk-generate/ideation-phase';
import { StoryPhase } from './bulk-generate/story-phase';
import { ScreenplayPhase } from './bulk-generate/screenplay-phase';
import { AssetsPhase } from './bulk-generate/assets-phase';
import { ShotsPhase } from './bulk-generate/shots-phase';
import { DonePhase } from './bulk-generate/done-phase';

// ============================================================================
// Types
// ============================================================================

export type BulkPhase =
  | 'selection'
  | 'ideation'
  | 'story'
  | 'screenplay'
  | 'assets'
  | 'shots'
  | 'done';

export type PhaseItemStatus =
  | 'pending'
  | 'generating'
  | 'done'
  | 'skipped'
  | 'error'
  | 'review';

export interface EpisodeBulkState {
  episodeId: string;
  episodeNumber: number;
  title: string;
  currentStatus: string;
  version: number;
  selected: boolean;
  duration: number;
  contentStyle: 'dialogue-heavy' | 'balanced' | 'action-heavy';
  // Ideation
  ideationStatus: PhaseItemStatus;
  ideas?: Array<{
    title: string;
    logline: string;
    themes?: string[];
    hook?: string;
    visualDirection?: string;
  }>;
  selectedIdeaIndex?: number;
  // Story
  storyStatus: PhaseItemStatus;
  storyPreview?: string | null;
  refinementNotes?: string;
  // Screenplay
  screenplayStatus: PhaseItemStatus;
  sceneCount?: number;
  dialogueCount?: number;
  // Assets
  unlinkedCharacters: string[];
  unlinkedLocations: string[];
  assetsCreated: boolean;
  // Shots
  shotStatus: PhaseItemStatus;
  shotCount?: number;
  // Errors
  error?: string;
}

export interface BulkState {
  phase: BulkPhase;
  episodes: Map<string, EpisodeBulkState>;
  isGenerating: boolean;
  cancelled: boolean;
  error?: string;
}

// ============================================================================
// Actions
// ============================================================================

export type BulkAction =
  | { type: 'INIT_EPISODES'; episodes: EpisodeBulkState[] }
  | { type: 'TOGGLE_EPISODE'; episodeId: string }
  | { type: 'SELECT_ALL' }
  | { type: 'DESELECT_ALL' }
  | { type: 'SET_DURATION'; episodeId: string; duration: number }
  | { type: 'SET_ALL_DURATIONS'; duration: number }
  | {
      type: 'SET_CONTENT_STYLE';
      episodeId: string;
      style: 'dialogue-heavy' | 'balanced' | 'action-heavy';
    }
  | {
      type: 'SET_ALL_CONTENT_STYLES';
      style: 'dialogue-heavy' | 'balanced' | 'action-heavy';
    }
  | { type: 'SET_PHASE'; phase: BulkPhase }
  | { type: 'SET_GENERATING'; isGenerating: boolean }
  | {
      type: 'SET_IDEATION_STATUS';
      episodeId: string;
      status: PhaseItemStatus;
      ideas?: EpisodeBulkState['ideas'];
    }
  | { type: 'SELECT_IDEA'; episodeId: string; index: number }
  | {
      type: 'SET_STORY_STATUS';
      episodeId: string;
      status: PhaseItemStatus;
      preview?: string | null;
    }
  | { type: 'SET_REFINEMENT_NOTES'; episodeId: string; notes: string }
  | {
      type: 'SET_SCREENPLAY_STATUS';
      episodeId: string;
      status: PhaseItemStatus;
      sceneCount?: number;
      dialogueCount?: number;
    }
  | {
      type: 'SET_ASSETS';
      episodeId: string;
      characters: string[];
      locations: string[];
    }
  | { type: 'SET_ASSETS_CREATED'; episodeId: string }
  | {
      type: 'SET_SHOT_STATUS';
      episodeId: string;
      status: PhaseItemStatus;
      shotCount?: number;
    }
  | { type: 'SET_EPISODE_ERROR'; episodeId: string; error: string }
  | {
      type: 'UPDATE_EPISODE_VERSION';
      episodeId: string;
      version: number;
      status: string;
    }
  | { type: 'CANCEL' }
  | { type: 'RESET' };

// ============================================================================
// Reducer
// ============================================================================

function updateEpisode(
  state: BulkState,
  episodeId: string,
  updater: (ep: EpisodeBulkState) => Partial<EpisodeBulkState>,
): BulkState {
  const ep = state.episodes.get(episodeId);
  if (!ep) return state;
  const newMap = new Map(state.episodes);
  newMap.set(episodeId, { ...ep, ...updater(ep) });
  return { ...state, episodes: newMap };
}

function bulkReducer(state: BulkState, action: BulkAction): BulkState {
  switch (action.type) {
    case 'INIT_EPISODES': {
      const map = new Map<string, EpisodeBulkState>();
      for (const ep of action.episodes) map.set(ep.episodeId, ep);
      return { ...state, episodes: map };
    }
    case 'TOGGLE_EPISODE':
      return updateEpisode(state, action.episodeId, (ep) => ({
        selected: !ep.selected,
      }));
    case 'SELECT_ALL': {
      const newMap = new Map(state.episodes);
      for (const [id, ep] of newMap) newMap.set(id, { ...ep, selected: true });
      return { ...state, episodes: newMap };
    }
    case 'DESELECT_ALL': {
      const newMap = new Map(state.episodes);
      for (const [id, ep] of newMap) newMap.set(id, { ...ep, selected: false });
      return { ...state, episodes: newMap };
    }
    case 'SET_DURATION':
      return updateEpisode(state, action.episodeId, () => ({
        duration: action.duration,
      }));
    case 'SET_ALL_DURATIONS': {
      const newMap = new Map(state.episodes);
      for (const [id, ep] of newMap)
        newMap.set(id, { ...ep, duration: action.duration });
      return { ...state, episodes: newMap };
    }
    case 'SET_CONTENT_STYLE':
      return updateEpisode(state, action.episodeId, () => ({
        contentStyle: action.style,
      }));
    case 'SET_ALL_CONTENT_STYLES': {
      const newMap = new Map(state.episodes);
      for (const [id, ep] of newMap)
        newMap.set(id, { ...ep, contentStyle: action.style });
      return { ...state, episodes: newMap };
    }
    case 'SET_PHASE':
      return { ...state, phase: action.phase };
    case 'SET_GENERATING':
      return { ...state, isGenerating: action.isGenerating };
    case 'SET_IDEATION_STATUS':
      return updateEpisode(state, action.episodeId, () => ({
        ideationStatus: action.status,
        ...(action.ideas !== undefined ? { ideas: action.ideas } : {}),
      }));
    case 'SELECT_IDEA':
      return updateEpisode(state, action.episodeId, () => ({
        selectedIdeaIndex: action.index,
      }));
    case 'SET_STORY_STATUS':
      return updateEpisode(state, action.episodeId, () => ({
        storyStatus: action.status,
        ...(action.preview !== undefined
          ? { storyPreview: action.preview }
          : {}),
      }));
    case 'SET_REFINEMENT_NOTES':
      return updateEpisode(state, action.episodeId, () => ({
        refinementNotes: action.notes,
      }));
    case 'SET_SCREENPLAY_STATUS':
      return updateEpisode(state, action.episodeId, () => ({
        screenplayStatus: action.status,
        ...(action.sceneCount !== undefined
          ? { sceneCount: action.sceneCount }
          : {}),
        ...(action.dialogueCount !== undefined
          ? { dialogueCount: action.dialogueCount }
          : {}),
      }));
    case 'SET_ASSETS':
      return updateEpisode(state, action.episodeId, () => ({
        unlinkedCharacters: action.characters,
        unlinkedLocations: action.locations,
      }));
    case 'SET_ASSETS_CREATED':
      return updateEpisode(state, action.episodeId, () => ({
        assetsCreated: true,
      }));
    case 'SET_SHOT_STATUS':
      return updateEpisode(state, action.episodeId, () => ({
        shotStatus: action.status,
        ...(action.shotCount !== undefined
          ? { shotCount: action.shotCount }
          : {}),
      }));
    case 'SET_EPISODE_ERROR':
      return updateEpisode(state, action.episodeId, () => ({
        error: action.error,
      }));
    case 'UPDATE_EPISODE_VERSION':
      return updateEpisode(state, action.episodeId, () => ({
        version: action.version,
        currentStatus: action.status,
      }));
    case 'CANCEL':
      return { ...state, cancelled: true, isGenerating: false };
    case 'RESET':
      return {
        ...state,
        phase: 'selection',
        isGenerating: false,
        cancelled: false,
        error: undefined,
      };
    default:
      return state;
  }
}

// ============================================================================
// Phase config
// ============================================================================

const PHASES: { key: BulkPhase; label: string; shortLabel: string }[] = [
  { key: 'selection', label: 'Select Episodes', shortLabel: 'Select' },
  { key: 'ideation', label: 'Story Ideas', shortLabel: 'Ideas' },
  { key: 'story', label: 'Stories', shortLabel: 'Stories' },
  { key: 'screenplay', label: 'Screenplays', shortLabel: 'Screenplays' },
  { key: 'assets', label: 'Assets', shortLabel: 'Assets' },
  { key: 'shots', label: 'Shot Lists', shortLabel: 'Shots' },
  { key: 'done', label: 'Complete', shortLabel: 'Done' },
];

// ============================================================================
// Props
// ============================================================================

interface BulkGenerateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seasonId: string;
  seasonNumber: number;
  projectId: string;
  episodes: Episode[];
}

// ============================================================================
// Status helpers
// ============================================================================

const STATUS_ORDER = [
  'draft',
  'story',
  'storyboard',
  'generating',
  'editing',
  'ready',
  'published',
];

export function statusIndex(status: string): number {
  return STATUS_ORDER.indexOf(status);
}

// ============================================================================
// Component
// ============================================================================

export function BulkGenerateModal({
  open,
  onOpenChange,
  seasonId,
  seasonNumber,
  projectId,
  episodes,
}: BulkGenerateModalProps) {
  const cancelledRef = useRef(false);

  const initialState: BulkState = {
    phase: 'selection',
    episodes: new Map(
      [...episodes]
        .sort((a, b) => a.number - b.number)
        .map((ep) => [
          ep.id,
          {
            episodeId: ep.id,
            episodeNumber: ep.number,
            title: ep.title,
            currentStatus: ep.status,
            version: ep.version,
            selected: true,
            duration: ep.durationSeconds ?? 300,
            contentStyle: 'dialogue-heavy' as const,
            ideationStatus: statusIndex(ep.status) >= 1 ? 'skipped' : 'pending',
            storyStatus: statusIndex(ep.status) >= 1 ? 'skipped' : 'pending',
            screenplayStatus:
              statusIndex(ep.status) >= 2 ? 'skipped' : 'pending',
            shotStatus: statusIndex(ep.status) >= 3 ? 'skipped' : 'pending',
            storyPreview: ep.storyData?.fullStory
              ? String(ep.storyData.fullStory).substring(0, 300)
              : null,
            sceneCount: ep.screenplayData?.scenes?.length,
            unlinkedCharacters: [],
            unlinkedLocations: [],
            assetsCreated: false,
          } satisfies EpisodeBulkState,
        ]),
    ),
    isGenerating: false,
    cancelled: false,
  };

  const [state, dispatch] = useReducer(bulkReducer, initialState);

  const currentPhaseIndex = PHASES.findIndex((p) => p.key === state.phase);

  const selectedEpisodes = Array.from(state.episodes.values()).filter(
    (ep) => ep.selected,
  );

  const progress =
    state.phase === 'done'
      ? 100
      : Math.round((currentPhaseIndex / (PHASES.length - 1)) * 100);

  const handleClose = useCallback(
    (newOpen: boolean) => {
      if (state.isGenerating) return; // prevent close during generation
      onOpenChange(newOpen);
    },
    [state.isGenerating, onOpenChange],
  );

  const handleCancel = useCallback(() => {
    cancelledRef.current = true;
    dispatch({ type: 'CANCEL' });
  }, []);

  const goToPhase = useCallback((phase: BulkPhase) => {
    dispatch({ type: 'SET_PHASE', phase });
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        <DialogHeader className="shrink-0 border-b border-white/10 px-6 py-4">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="flex items-center gap-2 text-lg font-semibold">
                <Wand2 className="h-5 w-5 text-blue-400" />
                Bulk Generate — Season {seasonNumber}
              </DialogTitle>
              <DialogDescription className="mt-1 text-sm text-white/50">
                {selectedEpisodes.length} episode
                {selectedEpisodes.length !== 1 ? 's' : ''} selected
              </DialogDescription>
            </div>
            {state.isGenerating && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                className="text-red-400 hover:text-red-300"
              >
                Cancel
              </Button>
            )}
          </div>

          {/* Phase stepper */}
          <div className="mt-4 flex items-center gap-1">
            {PHASES.map((phase, i) => (
              <div key={phase.key} className="flex items-center">
                {i > 0 && (
                  <div
                    className={cn(
                      'mx-1 h-px w-4',
                      i <= currentPhaseIndex
                        ? 'bg-blue-500/60'
                        : 'bg-white/10',
                    )}
                  />
                )}
                <div
                  className={cn(
                    'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                    i === currentPhaseIndex
                      ? 'bg-blue-500/20 text-blue-400'
                      : i < currentPhaseIndex
                        ? 'bg-emerald-500/10 text-emerald-400'
                        : 'text-white/30',
                  )}
                >
                  {phase.shortLabel}
                </div>
              </div>
            ))}
          </div>
          <Progress value={progress} className="mt-3 h-1" />
        </DialogHeader>

        {/* Phase content */}
        <div className="min-h-0 flex-1">
          {state.phase === 'selection' && (
            <SelectionPhase
              state={state}
              dispatch={dispatch}
              onNext={() => goToPhase('ideation')}
            />
          )}
          {state.phase === 'ideation' && (
            <IdeationPhase
              state={state}
              dispatch={dispatch}
              cancelledRef={cancelledRef}
              projectId={projectId}
              seasonId={seasonId}
              onNext={() => goToPhase('story')}
              onBack={() => goToPhase('selection')}
            />
          )}
          {state.phase === 'story' && (
            <StoryPhase
              state={state}
              dispatch={dispatch}
              cancelledRef={cancelledRef}
              projectId={projectId}
              seasonId={seasonId}
              onNext={() => goToPhase('screenplay')}
              onBack={() => goToPhase('ideation')}
            />
          )}
          {state.phase === 'screenplay' && (
            <ScreenplayPhase
              state={state}
              dispatch={dispatch}
              cancelledRef={cancelledRef}
              projectId={projectId}
              seasonId={seasonId}
              onNext={() => goToPhase('assets')}
              onBack={() => goToPhase('story')}
            />
          )}
          {state.phase === 'assets' && (
            <AssetsPhase
              state={state}
              dispatch={dispatch}
              projectId={projectId}
              onNext={() => goToPhase('shots')}
              onBack={() => goToPhase('screenplay')}
            />
          )}
          {state.phase === 'shots' && (
            <ShotsPhase
              state={state}
              dispatch={dispatch}
              cancelledRef={cancelledRef}
              projectId={projectId}
              seasonId={seasonId}
              onNext={() => goToPhase('done')}
              onBack={() => goToPhase('assets')}
            />
          )}
          {state.phase === 'done' && (
            <DonePhase
              state={state}
              onClose={() => onOpenChange(false)}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
