import { z } from 'zod';

import {
  type Scene,
  SceneSchema,
  type TimeOfDay,
} from '@kit/prompt-engine/schemas';

/**
 * A finished script, read into the screenplay stage's scenes (FILM-2205):
 * Fountain, Final Draft (.fdx) or plain text. The result is checked with
 * the stage's own SceneSchema, so an imported screenplay is shaped exactly
 * as a generated one. Pure: the dialog previews with it, the server stores
 * with it.
 */
export const MAX_SCRIPT_CHARS = 500_000;

export type ScriptFormat = 'fountain' | 'fdx' | 'text';

export type ScriptImportResult =
  | { ok: true; format: ScriptFormat; scenes: Scene[] }
  | { ok: false; error: string };

type Element =
  | { kind: 'heading'; text: string }
  | { kind: 'action'; text: string }
  | { kind: 'character'; text: string }
  | { kind: 'parenthetical'; text: string }
  | { kind: 'dialogue'; text: string };

/** Spoken words per second, for a scene's estimated running time */
const WORDS_PER_SECOND = 2.5;

export function parseScript(text: string): ScriptImportResult {
  if (text.length > MAX_SCRIPT_CHARS) {
    return {
      ok: false,
      error: `The script is longer than ${MAX_SCRIPT_CHARS.toLocaleString('en')} characters.`,
    };
  }

  if (!text.trim()) {
    return { ok: false, error: 'The script is empty.' };
  }

  const format = detectFormat(text);
  const elements =
    format === 'fdx' ? fdxElements(text) : fountainElements(text);
  const scenes = scenesFrom(elements);

  if (scenes.length === 0) {
    return { ok: false, error: 'No scenes were found in the script.' };
  }

  const parsed = z.array(SceneSchema).safeParse(scenes);

  if (!parsed.success) {
    return {
      ok: false,
      error: `The script could not be read as scenes: ${parsed.error.issues[0]?.message ?? 'unknown problem'}.`,
    };
  }

  return { ok: true, format, scenes: parsed.data };
}

export function detectFormat(text: string): ScriptFormat {
  const head = text.trimStart().slice(0, 500);

  if (head.startsWith('<?xml') || head.includes('<FinalDraft')) return 'fdx';

  return HEADING.test(text.split('\n').find((line) => line.trim()) ?? '') ||
    text.split('\n').some((line) => HEADING.test(line.trim()))
    ? 'fountain'
    : 'text';
}

const HEADING = /^(?:\.(?!\.)|(?:INT|EXT|EST|INT\.?\/EXT|I\/E)[.\s])/i;
const CHARACTER = /^@?[A-Z0-9][A-Z0-9 .'\-#&]*(?:\s*\(.*\))?\s*\^?$/;
const TRANSITION = /^(?:>.*|[A-Z ]+TO:)$/;

/** Fountain (and plain text, which is Fountain without headings) */
function fountainElements(source: string): Element[] {
  const text = source
    .replace(/\r\n?/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\[\[[\s\S]*?\]\]/g, '');
  const lines = withoutTitlePage(text.split('\n'));
  const elements: Element[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();

    if (!line || TRANSITION.test(line) || line.startsWith('=')) continue;
    if (line.startsWith('#')) continue; // sections

    if (HEADING.test(line) && blank(lines[i - 1])) {
      elements.push({
        kind: 'heading',
        text: line.replace(/^\./, '').replace(/\s*#.*#\s*$/, ''),
      });
      continue;
    }

    const next = lines[i + 1]?.trim();

    if (
      CHARACTER.test(line) &&
      /[A-Z]/.test(line) &&
      blank(lines[i - 1]) &&
      next
    ) {
      elements.push({ kind: 'character', text: characterName(line) });

      // The speech: parentheticals and lines until a blank line
      for (i = i + 1; i < lines.length && lines[i]!.trim(); i++) {
        const speech = lines[i]!.trim();

        elements.push(
          /^\(.*\)$/.test(speech)
            ? { kind: 'parenthetical', text: speech.slice(1, -1) }
            : { kind: 'dialogue', text: speech },
        );
      }

      continue;
    }

    elements.push({ kind: 'action', text: line.replace(/^!/, '') });
  }

  return elements;
}

/** A Fountain title page: key: value lines before the first blank line */
function withoutTitlePage(lines: string[]) {
  if (!/^[A-Za-z ]+:/.test(lines[0] ?? '') || HEADING.test(lines[0] ?? '')) {
    return lines;
  }

  const end = lines.findIndex((line) => !line.trim());

  return end === -1 ? lines : lines.slice(end + 1);
}

function blank(line: string | undefined) {
  return line === undefined || !line.trim();
}

function characterName(line: string) {
  return line
    .replace(/^@/, '')
    .replace(/\^$/, '')
    .replace(/\s*\(.*\)\s*$/, '')
    .trim();
}

const FDX_KIND: Record<string, Element['kind'] | undefined> = {
  'Scene Heading': 'heading',
  Action: 'action',
  Character: 'character',
  Parenthetical: 'parenthetical',
  Dialogue: 'dialogue',
};

/** Final Draft: each <Paragraph Type="…"> with its <Text> runs */
function fdxElements(xml: string): Element[] {
  const elements: Element[] = [];
  const paragraphs = xml.matchAll(
    /<Paragraph\b[^>]*\bType="([^"]+)"[^>]*>([\s\S]*?)<\/Paragraph>/g,
  );

  for (const [, type, body] of paragraphs) {
    const kind = FDX_KIND[type!];
    if (!kind) continue;

    const text = decodeXml(
      [...body!.matchAll(/<Text\b[^>]*>([\s\S]*?)<\/Text>/g)]
        .map(([, run]) => run)
        .join(''),
    ).trim();

    if (!text) continue;

    elements.push(
      kind === 'character'
        ? { kind, text: characterName(text) }
        : kind === 'parenthetical'
          ? { kind, text: text.replace(/^\(|\)$/g, '') }
          : { kind, text },
    );
  }

  return elements;
}

function decodeXml(text: string) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCharCode(Number(code)),
    )
    .replace(/&amp;/g, '&');
}

const TIME_OF_DAY: Array<[RegExp, TimeOfDay]> = [
  [/GOLDEN HOUR/, 'golden-hour'],
  [/DAWN|SUNRISE/, 'dawn'],
  [/MORNING/, 'morning'],
  // Before midday: AFTERNOON contains NOON
  [/AFTERNOON/, 'afternoon'],
  [/MIDDAY|NOON/, 'midday'],
  [/DUSK|SUNSET|EVENING/, 'dusk'],
  [/NIGHT|MIDNIGHT/, 'night'],
];

function headingParts(heading: string): {
  location: string;
  timeOfDay: TimeOfDay;
} {
  const withoutPrefix = heading
    .replace(/^(?:INT\.?\/EXT|I\/E|INT|EXT|EST)[.\s]+/i, '')
    .trim();
  const [place, ...rest] = withoutPrefix.split(/\s+[-–—]\s+/);
  const when = rest.join(' ').toUpperCase();

  return {
    location: (place ?? withoutPrefix).trim() || heading,
    timeOfDay:
      TIME_OF_DAY.find(([pattern]) => pattern.test(when))?.[1] ?? 'day',
  };
}

function scenesFrom(elements: Element[]): Scene[] {
  const scenes: Scene[] = [];
  let current: Scene | null = null;
  let speaker: string | null = null;
  let parenthetical: string | null = null;

  const open = (heading: string) => {
    current = {
      number: scenes.length + 1,
      heading,
      ...headingParts(heading),
      description: '',
      dialogue: [],
      estimatedDuration: 0,
    };
    scenes.push(current);
  };

  for (const element of elements) {
    if (element.kind === 'heading') {
      open(element.text.toUpperCase());
      speaker = null;
      continue;
    }

    // Text before any heading (plain text): one untitled scene
    if (!current) open('SCENE 1');
    const scene = current!;

    switch (element.kind) {
      case 'action':
        scene.description = scene.description
          ? `${scene.description}\n${element.text}`
          : element.text;
        speaker = null;
        break;
      case 'character':
        speaker = element.text;
        parenthetical = null;
        break;
      case 'parenthetical':
        parenthetical = element.text;
        break;
      case 'dialogue': {
        const last = scene.dialogue[scene.dialogue.length - 1];

        // Consecutive lines of one speech are one dialogue line
        if (speaker && last && last.character === speaker && !parenthetical) {
          last.text = `${last.text} ${element.text}`;
        } else if (speaker) {
          scene.dialogue.push({
            character: speaker,
            text: element.text,
            ...(parenthetical ? { parenthetical } : {}),
          });
          parenthetical = null;
        } else {
          scene.description = scene.description
            ? `${scene.description}\n${element.text}`
            : element.text;
        }
        break;
      }
    }
  }

  for (const scene of scenes) {
    const words = [
      scene.description,
      ...scene.dialogue.map((line) => line.text),
    ]
      .join(' ')
      .split(/\s+/)
      .filter(Boolean).length;

    scene.estimatedDuration = Math.max(5, Math.round(words / WORDS_PER_SECOND));
  }

  return scenes;
}
