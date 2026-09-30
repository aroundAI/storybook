export interface ContinuityContextInput {
  immutableEvents: Array<{
    id: string;
    eventType: string;
    eventKey: string;
    description: string;
    episodeNumber: number;
  }>;
  activeThreads: Array<{
    id: string;
    threadName: string;
    status: string;
    promises?: string[];
  }>;
  characterStates: Array<{
    characterId: string;
    characterName: string;
    constraints: string[];
    currentStates: Array<{ stateType: string; stateValue: unknown }>;
  }>;
}

export interface ContinuitySceneInput {
  heading: string;
  description: string;
  dialogue: Array<{ character: string; text: string }>;
}

export interface ContinuityViolationInput {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion: string;
}

export interface ContinuityView {
  mustNotContradict: Array<{
    id: string;
    label: string;
    description: string;
    episodeNumber: number;
  }>;
  openThreads: Array<{ id: string; name: string; status: string }>;
  characters: Array<{
    id: string;
    name: string;
    state: string | null;
    constraints: string[];
  }>;
  violations: ContinuityViolationInput[];
  isEmpty: boolean;
}

export const MAX_EVENTS = 6;
export const MAX_THREADS = 5;
export const MAX_CHARACTERS = 6;

const SEVERITY_ORDER = { error: 0, warning: 1, info: 2 } as const;

function sceneText(scene: ContinuitySceneInput): string {
  return [
    scene.heading,
    scene.description,
    ...scene.dialogue.flatMap((line) => [line.character, line.text]),
  ]
    .join(' ')
    .toLowerCase();
}

function mentions(text: string, name: string): boolean {
  const needle = name.trim().toLowerCase();

  return needle.length > 0 && text.includes(needle);
}

function stateLabel(
  states: ContinuityContextInput['characterStates'][number]['currentStates'],
): string | null {
  const latest = states[0];
  if (!latest) return null;

  const value = latest.stateValue;
  const detail =
    value && typeof value === 'object'
      ? Object.values(value).find((v) => typeof v === 'string')
      : undefined;

  return typeof detail === 'string'
    ? `${latest.stateType}: ${detail}`
    : latest.stateType;
}

function humanize(eventType: string): string {
  return eventType.replace(/_/g, ' ');
}

/**
 * What a writer should keep in mind while reading one scene: the immutable
 * events it must not contradict, the open threads, the characters in it with
 * their state, and any violations found in its text. Events and threads the
 * scene names come first; deaths lead the events, since a scene that shows
 * the dead alive is the costliest slip. Characters are those the scene names,
 * or, when it names none the canon knows, the first few the canon holds.
 */
export function buildContinuityView(
  context: ContinuityContextInput,
  scene: ContinuitySceneInput,
  violations: ContinuityViolationInput[] = [],
): ContinuityView {
  const text = sceneText(scene);

  const mustNotContradict = [...context.immutableEvents]
    .map((event, index) => ({
      event,
      index,
      named:
        mentions(text, event.eventKey.split(':')[1] ?? '') ||
        mentions(text, event.description),
    }))
    .sort(
      (a, b) =>
        Number(b.named) - Number(a.named) ||
        Number(b.event.eventType === 'death') -
          Number(a.event.eventType === 'death') ||
        a.index - b.index,
    )
    .slice(0, MAX_EVENTS)
    .map(({ event }) => ({
      id: event.id,
      label: humanize(event.eventType),
      description: event.description,
      episodeNumber: event.episodeNumber,
    }));

  const openThreads = context.activeThreads
    .filter(
      (thread) => thread.status === 'open' || thread.status === 'progressed',
    )
    .map((thread, index) => ({
      thread,
      index,
      named: mentions(text, thread.threadName),
    }))
    .sort((a, b) => Number(b.named) - Number(a.named) || a.index - b.index)
    .slice(0, MAX_THREADS)
    .map(({ thread }) => ({
      id: thread.id,
      name: thread.threadName,
      status: thread.status,
    }));

  const inScene = context.characterStates.filter((c) =>
    mentions(text, c.characterName),
  );

  const characters = (inScene.length > 0 ? inScene : context.characterStates)
    .slice(0, MAX_CHARACTERS)
    .map((c) => ({
      id: c.characterId,
      name: c.characterName,
      state: stateLabel(c.currentStates),
      constraints: c.constraints,
    }));

  const sortedViolations = [...violations].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  return {
    mustNotContradict,
    openThreads,
    characters,
    violations: sortedViolations,
    isEmpty:
      mustNotContradict.length === 0 &&
      openThreads.length === 0 &&
      characters.length === 0 &&
      sortedViolations.length === 0,
  };
}
