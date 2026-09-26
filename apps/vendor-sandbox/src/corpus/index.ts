import type { Rng } from '../rng';
import corpus from './corpus.json';

/**
 * The shared corpus: plausible, invented creator content (the phase README's
 * "Looks real, is fictional"). The schema decides a field's shape; this
 * decides its words, matched by field name. FILM-1802 reuses it for the
 * social sandbox.
 */
export { corpus };

export interface Cast {
  people: string[];
  locations: string[];
}

/**
 * One response's cast, drawn once, so every name and place in that response
 * comes from the same handful - a story's characters stay consistent.
 */
export function drawCast(rng: Rng): Cast {
  const firsts = rng.shuffle(corpus.firstNames).slice(0, rng.int(3, 5));
  const lasts = rng.shuffle(corpus.lastNames);

  return {
    people: firsts.map((first, i) => `${first} ${lasts[i]}`),
    locations: rng.shuffle(corpus.locations).slice(0, rng.int(2, 4)),
  };
}

function capitalise(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Fills `{a}`, `{b}` and `{loc}` from the cast. */
export function fillTemplate(template: string, rng: Rng, cast: Cast) {
  const [a, b] = rng.shuffle(cast.people);
  const filled = template
    .replaceAll('{a}', firstName(a ?? corpus.firstNames[0]!))
    .replaceAll('{b}', firstName(b ?? a ?? corpus.firstNames[1]!))
    .replaceAll('{loc}', rng.pick(cast.locations));

  return capitalise(filled);
}

function firstName(full: string) {
  return full.split(' ')[0] ?? full;
}

export function sentence(rng: Rng, cast: Cast) {
  return fillTemplate(rng.pick(corpus.sentenceTemplates), rng, cast);
}

export function paragraph(rng: Rng, cast: Cast, sentences = rng.int(2, 4)) {
  return Array.from({ length: sentences }, () => sentence(rng, cast)).join(' ');
}

type Filler = (rng: Rng, cast: Cast) => string;

export function uuid(rng: Rng) {
  const hex = Array.from({ length: 32 }, () => rng.int(0, 15).toString(16));
  hex[12] = '4';
  hex[16] = ((rng.int(0, 15) & 0x3) | 0x8).toString(16);
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

export function slugify(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function isoDate(rng: Rng) {
  const day = new Date(Date.UTC(2026, 0, 1) + rng.int(0, 364) * 86_400_000);
  return day.toISOString().slice(0, 10);
}

const pick =
  (pool: readonly string[]): Filler =>
  (rng) =>
    rng.pick(pool);

/**
 * Field name → words, checked in order against the field's own name. The
 * first match wins.
 */
const RULES: Array<[RegExp, Filler]> = [
  [
    /^id$|(fact|voice|scene|shot|character|episode|asset|segment|project)id$/,
    (rng) => uuid(rng),
  ],
  [
    /key$|slug$/,
    (rng, cast) =>
      slugify(sentence(rng, cast)).split('-').slice(0, 4).join('-'),
  ],
  [
    /(start|end)time$|timecode/,
    (rng) => `00:${String(rng.int(0, 8)).padStart(2, '0')}`,
  ],
  [
    /date$|^when$|timestamp|(created|updated|published)at$/,
    (rng) => isoDate(rng),
  ],
  [/url$|link$|href$/, (rng) => `https://sandbox.localhost/files/${uuid(rng)}`],
  [/^(series|show|project)(title|name)$/, pick(corpus.showTitles)],
  [
    /logline|premise|synopsis|pitch/,
    (rng, cast) => fillTemplate(rng.pick(corpus.loglineTemplates), rng, cast),
  ],
  [/title$|^title|headline/, pick(corpus.episodeTitles)],
  [
    /^(characters?|speakers?|people|persons?|cast|who|name)$|(character|speaker|person)(name)?s?$/,
    (rng, cast) => rng.pick(cast.people),
  ],
  [/location|setting|place|venue/, (rng, cast) => rng.pick(cast.locations)],
  [
    /dialogue|^lines?$|quote|utterance|spoken|shotline|signatureline|catchphrase/,
    pick(corpus.dialogue),
  ],
  [/^(original|translated)$/, pick(corpus.dialogue)],
  [/parenthetical/, pick(corpus.parentheticals)],
  [
    /heading|slugline/,
    (rng, cast) =>
      `${rng.pick(['INT.', 'EXT.'])} ${rng.pick(cast.locations).replace(/^the /, '').toUpperCase()} - ${rng.pick(['DAY', 'NIGHT', 'DAWN', 'DUSK'])}`,
  ],
  [/avoid|negative/, pick(corpus.negativePrompts)],
  [/threads?$|threadname/, pick(corpus.threads)],
  [
    /promises?$|setup$|payoff$|keymoment|evidence|worstoffender/,
    pick(corpus.hooks),
  ],
  [/role$/, pick(corpus.roles)],
  [/sources?(used)?$|citation/, pick(corpus.organizations)],
  [/howpresented|presentation|approach/, pick(corpus.critiques)],
  [/audience/, pick(corpus.audiences)],
  [/^act\d$|fulltext/, (rng, cast) => paragraph(rng, cast, rng.int(4, 7))],
  [/phases?$|^tags?$/, pick(corpus.themes)],
  [
    /insight|performer|opportunit|optimi[sz]ation|trend|characterfocus/,
    pick(corpus.insights),
  ],
  [/priorit(y|ies)|revision|^fix$/, pick(corpus.critiques)],
  [
    /hook|curiositygap|emotionalanchor|shareability|reveal|twist/,
    pick(corpus.hooks),
  ],
  [/^themes?$|theme|message|lesson|moral/, pick(corpus.themes)],
  [/genre/, pick(corpus.genres)],
  [/tone|mood|emotion|feeling|sentiment|arc$/, pick(corpus.emotions)],
  [
    /visual|camera|shot|framing|composition|style|lighting|subject|scene(description)?$|action|movement|blocking/,
    pick(corpus.visuals),
  ],
  [/sound|audio|ambien|sfx|music|noise/, pick(corpus.sounds)],
  [/hashtag/, pick(corpus.hashtags)],
  [/language/, pick(corpus.languages)],
  [/category|type|kind|topic/, pick(corpus.categories)],
  [/organi[sz]ation|company|publisher/, pick(corpus.organizations)],
  [/query|search/, pick(corpus.searchQueries)],
  [/claim|fact/, pick(corpus.claims)],
  [/post|caption|body|copy/, pick(corpus.postTexts)],
  [
    /reason|explanation|rationale|feedback|suggestion|improvement|note|strength|weakness|issue|critique|comment|assessment|analysis|verdict|why|recommend|evaluation|justification/,
    pick(corpus.critiques),
  ],
  [
    /summary|description|overview|beat|event|state|context|goal|motivation|backstory|outcome|conflict|stakes|plot|narrative|story|prompt|detail|appearance|content/,
    (rng, cast) => paragraph(rng, cast, rng.int(1, 3)),
  ],
];

/**
 * A field whose own name says nothing about its words (`text`, `content`)
 * takes its parent's: `dialogue[].text` is dialogue, `variants[].text` a
 * post. Any other field is placed by its own name only - a parent named
 * `shots` must not turn a shot's `characters` into camera directions.
 */
const GENERIC_FIELD = /^(text|content|value|label|item|entry|body|name)$/;

const PARENT_RULES: Array<[RegExp, Filler]> = [
  [/dialog|line|script|speech|transcript/, pick(corpus.dialogue)],
  [/beat/, pick(corpus.beatLabels)],
  [/variant|post|caption|social/, pick(corpus.postTexts)],
  [/organi[sz]ation|compan/, pick(corpus.organizations)],
  [/event/, pick(corpus.events)],
  [/location|place|venue/, (rng, cast) => rng.pick(cast.locations)],
];

const FIELD_OF_PATH = (path: readonly string[]) =>
  path
    .filter((part) => !/^\d+$/.test(part))
    .map((part) => part.toLowerCase().replaceAll('_', ''));

export interface PlacedString {
  value: string;
  placed: boolean;
}

/**
 * Realistic words for a string field, by its name. A field no rule places
 * still gets a real sentence, never a token, and is reported so the rules
 * grow with the schemas.
 */
export function stringForField(
  path: readonly string[],
  rng: Rng,
  cast: Cast,
): PlacedString {
  const [field = '', parent = ''] = FIELD_OF_PATH(path).reverse();

  if (GENERIC_FIELD.test(field)) {
    const rule = PARENT_RULES.find(([pattern]) => pattern.test(parent));
    if (rule) return { value: rule[1](rng, cast), placed: true };
  }

  const rule = RULES.find(([pattern]) => pattern.test(field));
  if (rule) return { value: rule[1](rng, cast), placed: true };

  return { value: sentence(rng, cast), placed: false };
}
