/**
 * OpenClaw Manifest Builder
 *
 * Produces a single JSON manifest that gives OpenClaw everything
 * it needs to autonomously generate an entire episode:
 * - Shots in generation order
 * - Transition decisions (cut vs. continuation)
 * - Frame chain (which shots inherit frames)
 * - Ingredient references (character + location images)
 * - First/last frame descriptions for image generation
 * - VEO prompts ready to paste into Flow
 */
import type { Asset } from '@kit/assets';

import {
  analyzeAllTransitions,
  resolveFrameChain,
} from '../server/transition-analyzer';
import { ShotMetadataSchema } from './schemas/shot-list.schema';
import type {
  EpisodeWithShots,
  FrameStrategy,
  PrimarySubject,
  TransitionType,
} from './types';

// ============================================================================
// OpenClaw Manifest Types
// ============================================================================

export interface OpenClawIngredient {
  name: string;
  imageUrl: string;
  /** Local file path (populated by OpenClaw after download) */
  localPath: string | null;
}

export interface OpenClawShotEntry {
  shotId: string;
  sequence: number;
  scene: number;
  shot: number;
  duration: number;
  description: string;

  // Transition intelligence
  transitionType: TransitionType;
  inheritLastFrame: boolean;
  continuationFromShotId: string | null;

  // Frame strategy
  frameStrategy: FrameStrategy;
  primarySubject: PrimarySubject;

  // Frame descriptions for image generation
  firstFrameDescription: string | null;
  lastFrameDescription: string | null;
  firstFrameSource: 'generated' | 'inherited' | 'manual';

  // Existing frame URLs (if already generated)
  firstFrameUrl: string | null;
  lastFrameUrl: string | null;

  // For continuations: the previous shot's last frame URL
  previousShotLastFrameUrl: string | null;

  // Location specificity
  locationName: string | null;
  locationArea: string | null;
  locationEnvironmentDescription: string | null;

  // The VEO prompt to paste into Flow
  veoPrompt: string;

  // Ingredients for Flow's "Ingredients-to-Video" workflow
  ingredients: {
    characters: OpenClawIngredient[];
    location: OpenClawIngredient | null;
  };

  // Generation status tracking
  status:
    | 'pending'
    | 'first_frame_generating'
    | 'last_frame_generating'
    | 'video_generating'
    | 'completed'
    | 'failed';

  // Output paths (populated by OpenClaw)
  output: {
    firstFrameLocalPath: string | null;
    lastFrameLocalPath: string | null;
    videoLocalPath: string | null;
  };
}

export interface OpenClawManifest {
  version: '1.0';
  generatedAt: string;
  episode: {
    id: string;
    title: string;
    projectId: string;
    totalShots: number;
    totalDurationSeconds: number;
    totalScenes: number;
  };
  summary: {
    cutsCount: number;
    continuationsCount: number;
    firstFramesToGenerate: number;
    lastFramesToGenerate: number;
    totalGenerationTasks: number;
  };
  shots: OpenClawShotEntry[];
}

// ============================================================================
// Local Path Mapping (for bundled ZIP exports)
// ============================================================================

export interface ShotLocalPaths {
  characterPaths: Map<string, string>;
  locationPath: string | null;
  firstFramePath: string | null;
  lastFramePath: string | null;
  videoPath: string | null;
}

// ============================================================================
// Builder
// ============================================================================

/**
 * Builds the complete OpenClaw manifest from episode data.
 *
 * When `localPathsMap` is provided (from the unified ZIP export),
 * the manifest's `localPath` and `output` fields are pre-populated
 * with ZIP-relative paths so OpenClaw can work entirely offline.
 */
export function buildOpenClawManifest(
  episode: Pick<EpisodeWithShots, 'id' | 'title' | 'projectId' | 'shots'>,
  projectCharacters: Asset[],
  projectLocations: Asset[],
  localPathsMap?: Map<string, ShotLocalPaths>,
): OpenClawManifest {
  const shots = [...episode.shots].sort(
    (a, b) => (a.sequenceNumber ?? 0) - (b.sequenceNumber ?? 0),
  );

  // Build lookup maps
  const characterImageMap = new Map<string, string>();
  for (const char of projectCharacters) {
    if (char.fileUrl) {
      characterImageMap.set(char.name.toLowerCase(), char.fileUrl);
    }
  }

  const locationImageMap = new Map<string, string>();
  for (const loc of projectLocations) {
    if (loc.fileUrl) {
      locationImageMap.set(loc.name.toLowerCase(), loc.fileUrl);
    }
  }

  // Analyze transitions
  const transitions = analyzeAllTransitions(shots);
  const frameChain = resolveFrameChain(shots);
  const transitionMap = new Map(transitions.map((t) => [t.shotId, t]));
  const frameChainMap = new Map(frameChain.map((f) => [f.shotId, f]));

  // Build shot map for looking up previous shot's last frame
  const shotMap = new Map(shots.map((s) => [s.id, s]));

  // Build manifest entries
  const manifestShots: OpenClawShotEntry[] = shots.map((shot) => {
    const transition = transitionMap.get(shot.id);
    const frame = frameChainMap.get(shot.id);
    const metadata = ShotMetadataSchema.nullish().parse(shot.metadata);

    const characters = metadata?.characters ?? [];
    const locationName = metadata?.location ?? null;

    // Get previous shot's last frame URL for continuations
    let previousShotLastFrameUrl: string | null = null;
    if (frame?.inheritFromShotId) {
      const prevShot = shotMap.get(frame.inheritFromShotId);
      previousShotLastFrameUrl = prevShot?.lastFrameUrl ?? null;
    }

    // Resolve local paths for this shot (if ZIP export)
    const shotPaths = localPathsMap?.get(shot.id);

    // Build character ingredients
    const characterIngredients: OpenClawIngredient[] = characters
      .map((name) => ({
        name,
        imageUrl: characterImageMap.get(name.toLowerCase()) ?? '',
        localPath: shotPaths?.characterPaths.get(name.toLowerCase()) ?? null,
      }))
      .filter((c) => c.imageUrl);

    // Build location ingredient
    let locationIngredient: OpenClawIngredient | null = null;
    if (locationName) {
      const url = locationImageMap.get(locationName.toLowerCase());
      if (url) {
        locationIngredient = {
          name: locationName,
          imageUrl: url,
          localPath: shotPaths?.locationPath ?? null,
        };
      }
    }

    // Get VEO prompt
    const veoPrompt =
      metadata?.veoPrompt?.fullPrompt ?? shot.prompt ?? shot.description;

    return {
      shotId: shot.id,
      sequence: shot.sequenceNumber ?? 0,
      scene: shot.sceneNumber,
      shot: shot.shotNumber,
      duration: shot.durationSeconds ?? shot.duration,
      description: shot.description,

      transitionType: transition?.transitionType ?? 'cut',
      inheritLastFrame: transition?.inheritLastFrame ?? false,
      continuationFromShotId: transition?.continuationFromShotId ?? null,

      frameStrategy: transition?.frameStrategy ?? 'environment_focus',
      primarySubject: transition?.primarySubject ?? {
        type: 'location',
        name: 'scene',
      },

      firstFrameDescription: shot.firstFrameDescription ?? null,
      lastFrameDescription: shot.lastFrameDescription ?? null,
      firstFrameSource: frame?.firstFrameSource ?? 'generated',

      firstFrameUrl: shot.firstFrameUrl ?? null,
      lastFrameUrl: shot.lastFrameUrl ?? null,
      previousShotLastFrameUrl,

      locationName,
      locationArea: shot.locationArea ?? null,
      locationEnvironmentDescription:
        shot.locationEnvironmentDescription ?? null,

      veoPrompt,

      ingredients: {
        characters: characterIngredients,
        location: locationIngredient,
      },

      status: 'pending',

      output: {
        firstFrameLocalPath: shotPaths?.firstFramePath ?? null,
        lastFrameLocalPath: shotPaths?.lastFramePath ?? null,
        videoLocalPath: shotPaths?.videoPath ?? null,
      },
    };
  });

  // Summary stats
  const cutsCount = manifestShots.filter(
    (s) => s.transitionType === 'cut',
  ).length;
  const continuationsCount = manifestShots.filter(
    (s) => s.transitionType === 'continuation',
  ).length;
  const firstFramesToGenerate = manifestShots.filter(
    (s) => s.firstFrameSource === 'generated' && s.firstFrameDescription,
  ).length;
  const lastFramesToGenerate = manifestShots.filter(
    (s) => s.lastFrameDescription,
  ).length;

  const totalScenes = new Set(shots.map((s) => s.sceneNumber)).size;
  const totalDuration = shots.reduce(
    (acc, s) => acc + (s.durationSeconds ?? s.duration),
    0,
  );

  return {
    version: '1.0',
    generatedAt: new Date().toISOString(),
    episode: {
      id: episode.id,
      title: episode.title,
      projectId: episode.projectId,
      totalShots: shots.length,
      totalDurationSeconds: totalDuration,
      totalScenes,
    },
    summary: {
      cutsCount,
      continuationsCount,
      firstFramesToGenerate,
      lastFramesToGenerate,
      totalGenerationTasks:
        firstFramesToGenerate + lastFramesToGenerate + shots.length,
    },
    shots: manifestShots,
  };
}
