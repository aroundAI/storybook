/**
 * The scenes a fact can be linked to (FILM-1142): those of the episode's
 * screenplay. A link names its scene by number, as text.
 */
export interface SceneOption {
  value: string;
  label: string;
}

export function sceneOptionsOf(screenplayData: unknown): SceneOption[] {
  if (
    !screenplayData ||
    typeof screenplayData !== 'object' ||
    !('scenes' in screenplayData) ||
    !Array.isArray(screenplayData.scenes)
  ) {
    return [];
  }

  return screenplayData.scenes.flatMap((scene: unknown) => {
    if (
      !scene ||
      typeof scene !== 'object' ||
      !('number' in scene) ||
      typeof scene.number !== 'number'
    ) {
      return [];
    }

    const heading =
      'heading' in scene && typeof scene.heading === 'string'
        ? scene.heading.trim()
        : '';

    return [
      {
        value: String(scene.number),
        label: heading
          ? `Scene ${scene.number}: ${heading}`
          : `Scene ${scene.number}`,
      },
    ];
  });
}
