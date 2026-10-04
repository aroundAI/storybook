import { corpus, paragraph } from '../../corpus';
import type { GenerateContext } from './context';

/**
 * What a model does that a schema cannot say: it reads the brief. A value
 * generated from a prompt's output schema has the right shape, but the
 * stage that receives it also checks it against what it asked for (FILM-1902
 * stage check()): the shots it named, the items it sent, the word count it
 * set, scene numbers that run 1, 2, 3. Each fitter here takes a generated
 * value and makes it honour what the rendered user prompt gives, the way a
 * model following the prompt would. Keyed by prompt registry key; a prompt
 * with no fitter is returned as generated.
 */

type Fitter = (
  value: unknown,
  userPrompt: string,
  ctx: GenerateContext,
) => unknown;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The first JSON array after `marker` in the prompt; undefined when none parses. */
export function jsonArrayAfter(userPrompt: string, marker: RegExp) {
  const at = userPrompt.search(marker);
  if (at < 0) return undefined;
  const start = userPrompt.indexOf('[', at);
  if (start < 0) return undefined;

  let depth = 0;
  for (let i = start; i < userPrompt.length; i++) {
    const c = userPrompt[i];
    if (c === '[') depth++;
    if (c === ']' && --depth === 0) {
      try {
        const parsed: unknown = JSON.parse(userPrompt.slice(start, i + 1));
        return Array.isArray(parsed) ? parsed : undefined;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** "600-900 words" → 600: the floor of the first word range the prompt sets. */
export function wordFloorFromPrompt(userPrompt: string) {
  const match = /(\d{2,5})\s*[-–]\s*\d{2,5}\s+words/i.exec(userPrompt);
  return match ? Number(match[1]) : undefined;
}

function words(text: string) {
  return text.split(/\s+/).filter(Boolean).length;
}

/** `text`, grown paragraph by paragraph until it holds `floor` words. */
function atLeastWords(text: string, floor: number, ctx: GenerateContext) {
  let out = text;
  while (words(out) < floor)
    out = `${out}\n\n${paragraph(ctx.rng, ctx.cast, 5)}`;
  return out;
}

/** `story-generation`: the story is as long as the brief's word range asks. */
const storyGeneration: Fitter = (value, userPrompt, ctx) => {
  const floor = wordFloorFromPrompt(userPrompt);
  if (!floor || !isObject(value) || !isObject(value.story)) return value;
  const story = value.story;
  if (typeof story.fullText !== 'string') return value;
  return {
    ...value,
    story: { ...story, fullText: atLeastWords(story.fullText, floor, ctx) },
  };
};

/**
 * A screenplay's scenes numbered 1, 2, 3, set in the places the prompt
 * names, and metadata that declares exactly the speakers and places used.
 */
function fitScreenplay(screenplay: Json, ctx: GenerateContext): Json {
  const scenes = Array.isArray(screenplay.scenes) ? screenplay.scenes : [];
  const fitted: Json[] = scenes.filter(isObject).map((scene, i) => ({
    ...scene,
    number: i + 1,
    location:
      ctx.cast.locations[i % ctx.cast.locations.length] ?? scene.location,
  }));
  const speakers = new Set<string>();
  for (const scene of fitted) {
    for (const line of Array.isArray(scene.dialogue) ? scene.dialogue : []) {
      if (isObject(line) && typeof line.character === 'string')
        speakers.add(line.character);
    }
  }
  const metadata = isObject(screenplay.metadata) ? screenplay.metadata : {};

  return {
    ...screenplay,
    scenes: fitted,
    metadata: {
      ...metadata,
      totalScenes: fitted.length,
      characters: [...speakers],
      locations: [...new Set(fitted.map((scene) => scene.location))],
    },
  };
}

/** `screenplay-refinement` and `screenplay-conversion` both wrap one in `screenplay`. */
const screenplay: Fitter = (value, _userPrompt, ctx) =>
  isObject(value) && isObject(value.screenplay)
    ? { ...value, screenplay: fitScreenplay(value.screenplay, ctx) }
    : value;

/** `season-generation`: each episode has its own number, 1 to n. */
const seasonGeneration: Fitter = (value) => {
  if (!isObject(value) || !Array.isArray(value.episodes)) return value;
  return {
    ...value,
    episodes: value.episodes.map((episode, i) =>
      isObject(episode) ? { ...episode, number: i + 1 } : episode,
    ),
  };
};

interface ShotRef {
  seq: number;
  duration: number;
}

/**
 * `scene-audio-refinement`: every cue starts on a shot of the sequence the
 * prompt lists, inside that shot, and lasts no longer than the shots left.
 */
const sceneAudio: Fitter = (value, userPrompt, ctx) => {
  const shots = (jsonArrayAfter(userPrompt, /SHOT SEQUENCE/) ?? []).filter(
    (s): s is ShotRef =>
      isObject(s) &&
      typeof s.seq === 'number' &&
      typeof s.duration === 'number',
  );
  if (shots.length === 0 || !isObject(value) || !Array.isArray(value.cues))
    return value;

  return {
    ...value,
    cues: value.cues.filter(isObject).map((cue, i) => {
      const index = i === 0 ? 0 : ctx.rng.int(0, shots.length - 1);
      const shot = shots[index]!;
      const remaining = shots
        .slice(index)
        .reduce((sum, s) => sum + s.duration, 0);
      const offset = Math.min(
        shot.duration,
        Math.max(0, Number(cue.startOffsetInShot) || 0),
      );
      return {
        ...cue,
        startShotSequence: shot.seq,
        startOffsetInShot: offset,
        durationSeconds: Math.max(
          1,
          Math.min(
            remaining - offset,
            Number(cue.durationSeconds) || remaining,
          ),
        ),
      };
    }),
  };
};

/**
 * `batch-translate-metadata`: one translation per item the prompt sent,
 * with that item's id and target language.
 */
const batchTranslateMetadata: Fitter = (value, userPrompt, ctx) => {
  const items = (jsonArrayAfter(userPrompt, /metadata items/i) ?? []).filter(
    (item): item is { id: string; targetLanguage: string } =>
      isObject(item) &&
      typeof item.id === 'string' &&
      typeof item.targetLanguage === 'string',
  );
  if (
    items.length === 0 ||
    !isObject(value) ||
    !Array.isArray(value.translations)
  )
    return value;
  const generated = value.translations.filter(isObject);

  return {
    ...value,
    translations: items.map((item, i) => ({
      title: ctx.rng.pick(corpus.dialogue),
      description: paragraph(ctx.rng, ctx.cast, 2),
      ...generated[i % Math.max(1, generated.length)],
      id: item.id,
      targetLanguage: item.targetLanguage,
    })),
  };
};

export const BRIEF_FITTERS: Record<string, Fitter> = {
  'batch-translate-metadata': batchTranslateMetadata,
  'scene-audio-refinement': sceneAudio,
  'screenplay-conversion': screenplay,
  'screenplay-refinement': screenplay,
  'season-generation': seasonGeneration,
  'story-generation': storyGeneration,
};

export function fitToBrief(
  key: string,
  value: unknown,
  userPrompt: string,
  ctx: GenerateContext,
) {
  const fit = BRIEF_FITTERS[key];
  return fit ? fit(value, userPrompt, ctx) : value;
}
