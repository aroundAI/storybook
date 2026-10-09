/**
 * The `episodes.screenplay_data` a screenplay is stored as, from its scenes:
 * the one shape the screenplay stage commits and a script import writes
 * (FILM-2205), with the totals and the location and character lists the
 * episode header shows. Pure.
 */
export interface ScreenplaySceneLike {
  location?: string | null;
  estimatedDuration?: number | null;
  dialogue?: Array<{ character?: string | null }> | null;
}

export function screenplayDataFromScenes<Scene extends ScreenplaySceneLike>(
  scenes: Scene[],
  options: {
    generatedAt: string;
    generatedBy: { model: string; provider: string; costCents: number };
  },
) {
  const locations = [
    ...new Set(
      scenes
        .map((scene) => scene.location)
        .filter((location): location is string => Boolean(location)),
    ),
  ];

  const characters = [
    ...new Set(
      scenes
        .flatMap((scene) => scene.dialogue || [])
        .map((line) => line.character)
        .filter((character): character is string => Boolean(character)),
    ),
  ];

  const estimatedDuration = scenes.reduce(
    (sum, scene) => sum + (scene.estimatedDuration || 0),
    0,
  );

  return {
    scenes,
    generatedAt: options.generatedAt,
    generatedBy: options.generatedBy,
    totalDialogueLines: scenes.flatMap((scene) => scene.dialogue || []).length,
    estimatedDuration,
    approvedAt: null,
    // Full metadata for episode header display
    metadata: {
      locations,
      characters,
      totalScenes: scenes.length,
      estimatedDuration,
    },
  };
}
