/**
 * The deterministic checks a screenplay's scenes pass before commit, in
 * both modes: no empty dialogue, speakers and locations that exist or are
 * declared for auto-creation, text length caps (`checkScenes`), and
 * contiguous numbering (`checkSceneNumbering`, which the caller anchors at
 * the number its slice starts from).
 */
import type { CheckError } from '../../types';

/** Generous caps: the columns are unbounded text, a runaway reply is not. */
export const SCREENPLAY_CAPS = {
  heading: 300,
  location: 200,
  description: 20_000,
  dialogueText: 4_000,
} as const;

export interface CheckableScene {
  number: number;
  heading: string;
  location: string;
  description: string;
  dialogue: Array<{ character: string; text: string }>;
}

export interface SceneCheckContext {
  /** Names the episode already has; matched case-insensitively */
  knownCharacters: ReadonlyArray<string>;
  knownLocations: ReadonlyArray<string>;
  /** Names the output flags for auto-creation */
  declaredCharacters: ReadonlyArray<string>;
  declaredLocations: ReadonlyArray<string>;
  /** Where the scenes sit in the output, e.g. `scenes` */
  path: string;
}

function lower(names: ReadonlyArray<string>) {
  return new Set(names.map((n) => n.trim().toLowerCase()));
}

export function checkScenes(
  scenes: ReadonlyArray<CheckableScene>,
  context: SceneCheckContext,
): CheckError[] {
  const errors: CheckError[] = [];
  const characters = lower([
    ...context.knownCharacters,
    ...context.declaredCharacters,
  ]);
  const locations = lower([
    ...context.knownLocations,
    ...context.declaredLocations,
  ]);

  scenes.forEach((scene, sceneIndex) => {
    const at = `${context.path}.${sceneIndex}`;

    if (!scene.heading.trim()) {
      errors.push({
        path: `${at}.heading`,
        code: 'empty_heading',
        message: 'A scene needs a heading (INT./EXT. LOCATION - TIME)',
      });
    } else if (scene.heading.length > SCREENPLAY_CAPS.heading) {
      errors.push(tooLong(`${at}.heading`, SCREENPLAY_CAPS.heading));
    }

    if (!scene.location.trim()) {
      errors.push({
        path: `${at}.location`,
        code: 'empty_location',
        message: 'A scene needs a location',
      });
    } else if (scene.location.length > SCREENPLAY_CAPS.location) {
      errors.push(tooLong(`${at}.location`, SCREENPLAY_CAPS.location));
    } else if (!locations.has(scene.location.trim().toLowerCase())) {
      errors.push({
        path: `${at}.location`,
        code: 'unknown_location',
        message: `"${scene.location}" is not one of the episode's locations and is not declared as new`,
      });
    }

    if (scene.description.length > SCREENPLAY_CAPS.description) {
      errors.push(tooLong(`${at}.description`, SCREENPLAY_CAPS.description));
    }

    scene.dialogue.forEach((line, lineIndex) => {
      const lineAt = `${at}.dialogue.${lineIndex}`;

      if (!line.character.trim()) {
        errors.push({
          path: `${lineAt}.character`,
          code: 'empty_speaker',
          message: 'A dialogue line needs a speaker',
        });
      } else if (!characters.has(line.character.trim().toLowerCase())) {
        errors.push({
          path: `${lineAt}.character`,
          code: 'unknown_character',
          message: `"${line.character}" is not one of the episode's characters and is not declared as new`,
        });
      }

      if (!line.text.trim()) {
        errors.push({
          path: `${lineAt}.text`,
          code: 'empty_dialogue',
          message: 'A dialogue line needs text',
        });
      } else if (line.text.length > SCREENPLAY_CAPS.dialogueText) {
        errors.push(tooLong(`${lineAt}.text`, SCREENPLAY_CAPS.dialogueText));
      }
    });
  });

  return errors;
}

/**
 * Scene numbers run 1, 2, 3 … with no gap or repeat. `first` is the number
 * the sequence must start at; a part that holds a slice of the screenplay
 * passes where its slice begins.
 */
export function checkSceneNumbering(
  scenes: ReadonlyArray<{ number: number }>,
  path: string,
  first = 1,
): CheckError[] {
  const errors: CheckError[] = [];

  scenes.forEach((scene, index) => {
    const expected = first + index;

    if (scene.number !== expected) {
      errors.push({
        path: `${path}.${index}.number`,
        code: 'scene_numbering',
        message: `Scene numbers must be contiguous: expected ${expected}, got ${scene.number}`,
      });
    }
  });

  return errors;
}

function tooLong(path: string, max: number): CheckError {
  return {
    path,
    code: 'too_long',
    message: `Must be at most ${max} characters`,
  };
}
