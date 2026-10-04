import { createHash } from 'node:crypto';

import type { EditPackageSources } from '../../src/build-edit-package';
import type { EpisodeRetentionCurve } from '../../src/retention-hints';

/**
 * FILM-2001: the seed behind the committed edit-package fixtures, and
 * behind the local-database run that times the real tool call.
 *
 * Deterministic: every id is derived from the fixture's name, so the same
 * seed always yields the same rows, the same package and the same etag.
 * Three episodes:
 *
 * | fixture   | shots | languages        | analytics            |
 * |-----------|-------|------------------|----------------------|
 * | 5-shots   | 5     | en               | unmeasured           |
 * | 20-shots  | 20    | en               | no published video   |
 * | 60-shots  | 60    | en + hi (dubbed) | a YouTube curve      |
 *
 * Each also carries the states a builder must handle: the last shot has no
 * video yet, one frame URL points into another project, one dialogue file
 * is missing from storage, a dialogue composite track is left out, and one
 * character image has a recorded SHA-256.
 *
 * Media URLs use local Supabase's public prefix, the shape every stored
 * media URL has. The fixtures' signed URLs come from `fixtureStorage`,
 * an adapter that signs nothing but has R2's URL length, so the size test
 * measures a realistic package.
 */

export const FIXTURE_PUBLIC_PREFIX =
  'http://127.0.0.1:55321/storage/v1/object/public';
export const FIXTURE_GENERATED_AT = new Date('2026-10-04T12:00:00.000Z');

export const FIXTURES = [
  { name: '5-shots', shots: 5, dubbed: false, retention: 'unmeasured' },
  { name: '20-shots', shots: 20, dubbed: false, retention: 'unpublished' },
  { name: '60-shots', shots: 60, dubbed: true, retention: 'curve' },
] as const;

export type FixtureSpec = (typeof FIXTURES)[number];

/** A stable UUID (v4 layout) derived from a name. */
export function fixtureUuid(...parts: Array<string | number>): string {
  const hex = createHash('sha256').update(parts.join(':')).digest('hex');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${'89ab'[parseInt(hex[16]!, 16) % 4]}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

const CHARACTERS = [
  { name: 'MAYA', role: 'protagonist', voice: 'voice-maya' },
  { name: 'ARJUN', role: 'supporting', voice: 'voice-arjun' },
] as const;

const EMOTIONS = ['calm', 'urgent', 'curious', 'relieved'] as const;
const TRANSITIONS = ['cut', 'continuation', 'cut', 'match_cut'] as const;
const SHOTS_PER_SCENE = 4;
const LINES_PER_SHOT = 2;

const HINDI_LINES = [
  'हमें अभी चलना होगा।',
  'क्या तुमने वह आवाज़ सुनी?',
  'प्रयोगशाला की बत्तियाँ बुझ गई हैं।',
  'मुझ पर भरोसा करो, यह काम करेगा।',
];

export interface FixtureSeed {
  spec: FixtureSpec;
  accountId: string;
  sources: EditPackageSources;
  retention: EpisodeRetentionCurve;
  /** Storage keys (`<bucket>/<path>`) that do not exist, by design. */
  missingKeys: Set<string>;
}

/**
 * Where to seed into. The fixtures use the derived ids; the contract test
 * passes a real team's project and episode, and every other id is derived
 * from them so two runs never collide.
 */
export interface SeedTarget {
  accountId: string;
  projectId: string;
  episodeId: string;
  /** The running Supabase's public storage prefix, when not lane A's. */
  publicPrefix?: string;
}

export function seedFixture(
  spec: FixtureSpec,
  target?: SeedTarget,
): FixtureSeed {
  const id = (...parts: Array<string | number>) =>
    target
      ? fixtureUuid('film-2001', spec.name, target.episodeId, ...parts)
      : fixtureUuid('film-2001', spec.name, ...parts);

  const accountId = target?.accountId ?? id('account');
  const projectId = target?.projectId ?? id('project');
  const episodeId = target?.episodeId ?? id('episode');
  const prefix = target?.publicPrefix ?? FIXTURE_PUBLIC_PREFIX;
  const media = (bucket: string, path: string) => `${prefix}/${bucket}/${path}`;
  const otherProjectId = fixtureUuid('film-2001', 'another-project');
  const sceneCount = Math.ceil(spec.shots / SHOTS_PER_SCENE);

  const characters = CHARACTERS.map((character) => ({
    id: id('character', character.name),
    name: character.name,
    description: `${character.name}, the ${character.role} of the series.`,
    file_url: media(
      'project-assets',
      `projects/${projectId}/assets/characters/${character.name.toLowerCase()}.png`,
    ),
    metadata: { role: character.role },
  }));

  const shots: EditPackageSources['shots'] = [];
  const dialogueLines: EditPackageSources['dialogueLines'] = [];
  let timeline = 0;

  for (let index = 0; index < spec.shots; index += 1) {
    const sequence = index + 1;
    const shotId = id('shot', sequence);
    const scene = Math.floor(index / SHOTS_PER_SCENE) + 1;
    const duration = 4 + (index % 3);
    const transition = TRANSITIONS[index % TRANSITIONS.length]!;
    const character = CHARACTERS[index % CHARACTERS.length]!;
    const last = sequence === spec.shots;
    const folder = `projects/${projectId}/shots/${shotId}`;

    shots.push({
      id: shotId,
      scene_number: scene,
      shot_number: (index % SHOTS_PER_SCENE) + 1,
      sequence_number: sequence,
      status: last ? 'queued' : 'completed',
      duration_seconds: duration,
      source_duration: last ? null : duration + 0.5,
      timeline_start_seconds: timeline,
      trim_in_point: last ? null : 0.2,
      trim_out_point: last ? null : duration + 0.2,
      transition_type: transition,
      prompt: `Subject: ${character.name}, early thirties, short dark hair, brown eyes, lab coat over a grey sweater. Action: ${character.name} turns toward the console as the alarm starts, breath catching. Scene: a dim research lab at night, blue monitor light, rain on the windows. Style: medium close-up, slow push-in, 35mm, shallow depth of field. Sounds: alarm tone, rain, server hum. Negative: no subtitles, no captions, no watermark. (shot ${sequence})`,
      action_description: `${character.name} reacts to the alarm (shot ${sequence}).`,
      camera_direction: index % 2 === 0 ? 'slow push-in' : 'static',
      primary_subject: { type: 'character', name: character.name },
      continuation_from_shot_id:
        transition === 'continuation' && index > 0 ? id('shot', index) : null,
      inherit_last_frame: transition === 'continuation' && index > 0,
      shorts_candidate: index % 10 === 3,
      video_url: last
        ? null
        : media('project-assets', `${folder}/video/shot-${sequence}.mp4`),
      first_frame_url: media(
        'project-assets',
        // One frame points into another project: never signed.
        sequence === 2
          ? `projects/${otherProjectId}/shots/${shotId}/image/first.png`
          : `${folder}/image/first-${sequence}.png`,
      ),
      last_frame_url: last
        ? null
        : media('project-assets', `${folder}/image/last-${sequence}.png`),
    });

    for (let line = 0; line < LINES_PER_SHOT; line += 1) {
      const lineSequence = index * LINES_PER_SHOT + line + 1;
      const lineId = id('dialogue', lineSequence);
      const speaker = CHARACTERS[(index + line) % CHARACTERS.length]!;

      dialogueLines.push({
        id: lineId,
        shot_id: shotId,
        scene_number: scene,
        sequence_number: lineSequence,
        character_name: speaker.name,
        character_asset_id: id('character', speaker.name),
        text: `Line ${lineSequence}: ${speaker.name} says what the scene needs, in about ten words.`,
        emotion: EMOTIONS[lineSequence % EMOTIONS.length]!,
        language: 'en',
        timeline_start_seconds: timeline + 0.4 + line * (duration / 2),
        estimated_duration_seconds: 1.6,
        status: last ? 'pending' : 'completed',
        audio_url: last
          ? null
          : media('audio', `episodes/${episodeId}/dialogue/${lineId}_1.mp3`),
      });
    }

    timeline += duration;
  }

  const scenes = Array.from({ length: sceneCount }, (_, index) => {
    const number = index + 1;
    const lines = dialogueLines.filter((line) => line.scene_number === number);

    return {
      number,
      heading: `INT. RESEARCH LAB - NIGHT (${number})`,
      description: `The team works the problem in scene ${number}.`,
      location: 'Research lab',
      timeOfDay: 'night',
      characters: CHARACTERS.map((c) => c.name),
      estimatedDuration: shots
        .filter((shot) => shot.scene_number === number)
        .reduce((sum, shot) => sum + shot.duration_seconds, 0),
      dialogue: lines.map((line) => ({
        character: line.character_name,
        text: line.text,
      })),
    };
  });

  const musicAssetId = id('audio-asset', 'music');
  const audioAssets = [
    {
      id: musicAssetId,
      file_url: media('audio', `${projectId}/music/${musicAssetId}.mp3`),
      is_loopable: true,
      tags: ['tense', 'electronic'],
    },
  ];
  const audioTracks: EditPackageSources['audioTracks'] = [
    {
      id: id('track', 'music'),
      type: 'music',
      name: 'Night lab theme',
      file_url: null,
      duration_seconds: timeline,
      timeline_start_seconds: 0,
      volume: 0.6,
      metadata: null,
      audio_asset_id: musicAssetId,
    },
    {
      id: id('track', 'sfx'),
      type: 'sfx',
      name: 'Alarm',
      file_url: media('audio', `${projectId}/sfx/${id('sfx')}.mp3`),
      duration_seconds: 2,
      timeline_start_seconds: 3,
      volume: 0.9,
      metadata: null,
      audio_asset_id: null,
    },
    {
      id: id('track', 'ambient'),
      type: 'ambient',
      name: 'Rain on glass',
      file_url: media('audio', `${projectId}/ambient/${id('ambient')}.mp3`),
      duration_seconds: timeline,
      timeline_start_seconds: 0,
      volume: 0.3,
      metadata: { loopable: true },
      audio_asset_id: null,
    },
    {
      id: id('track', 'composite'),
      type: 'dialogue_composite',
      name: 'Dialogue mix',
      file_url: media('audio', `${projectId}/dialogue/${id('mix')}.mp3`),
      duration_seconds: timeline,
      timeline_start_seconds: 0,
      volume: 1,
      metadata: null,
      audio_asset_id: null,
    },
  ];

  const languages = spec.dubbed ? ['en', 'hi'] : ['en'];
  const captions = languages.map((language) => ({
    id: id('caption', language),
    language,
    status: 'completed',
    style_preset: 'standard',
  }));
  const captionSegments = captions.flatMap((caption) =>
    dialogueLines.map((line, index) => ({
      id: id('segment', caption.language, index + 1),
      caption_id: caption.id,
      sequence_number: index + 1,
      start_time: line.timeline_start_seconds ?? 0,
      end_time: (line.timeline_start_seconds ?? 0) + 1.6,
      text:
        caption.language === 'en'
          ? line.text
          : HINDI_LINES[index % HINDI_LINES.length]!,
      speaker_id: line.character_asset_id,
    })),
  );

  const dubbedVersions = spec.dubbed
    ? [{ id: id('dub', 'hi'), language: 'hi', status: 'ready' }]
    : [];
  const dubbedLines = dubbedVersions.flatMap((version) =>
    dialogueLines.map((line, index) => ({
      id: id('dub-line', version.language, index + 1),
      dubbed_version_id: version.id,
      original_dialogue_id: line.id,
      translated_text: HINDI_LINES[index % HINDI_LINES.length]!,
      timing_adjustment: index % 2 === 0 ? 1 : 1.1,
      duration_seconds: 1.8,
      status: line.audio_url ? 'voiced' : 'pending',
      audio_url: line.audio_url
        ? media(
            'audio',
            `episodes/${episodeId}/dubbed/${version.language}/${id('dub-line', version.language, index + 1)}.mp3`,
          )
        : null,
    })),
  );

  const shorts = [
    {
      id: id('short', 1),
      start_seconds: 4,
      end_seconds: Math.min(timeline, 22),
      duration_seconds: Math.min(timeline, 22) - 4,
      viral_score: 8,
      hook_type: 'question',
      title: 'Who cut the power?',
      source_shot_id: id('shot', 2),
      status: 'pending',
    },
  ];

  const missingKeys = new Set<string>([
    // A dialogue file the row names but storage does not have.
    `audio/episodes/${episodeId}/dialogue/${id('dialogue', 3)}_1.mp3`,
  ]);

  const characterImage = characters[0]!.file_url;

  const retention: EpisodeRetentionCurve =
    spec.retention === 'unmeasured'
      ? { state: 'unmeasured' }
      : spec.retention === 'unpublished'
        ? { state: 'no_published_video' }
        : {
            state: 'curve',
            publishId: id('publish', 'youtube'),
            platform: 'youtube',
            asOf: '2026-10-03T06:00:00Z',
            durationSeconds: Math.round(timeline),
            points: RETENTION_CURVE,
          };

  return {
    spec,
    accountId,
    retention,
    missingKeys,
    sources: {
      project: {
        id: projectId,
        name: `Night Lab (${spec.name})`,
        slug: `night-lab-${spec.name}`,
        brand: spec.dubbed
          ? {
              colors: { primary: '#0EA5E9', captionText: '#FDE68A' },
              captionStyle: { position: 'bottom', emphasis: 'color' },
              transitionStyle: 'dissolve',
              musicStyle: ['electronic', 'tense'],
            }
          : {},
        edit_policy: spec.dubbed
          ? { targetDurationSeconds: 300, maxShotLength: 5 }
          : {},
      },
      episode: {
        id: episodeId,
        project_id: projectId,
        number: 1,
        title: `The Night the Lab Went Dark (${spec.name})`,
        status: 'storyboard',
        version: 7,
        target_duration_seconds: Math.round(timeline),
        metadata: {
          character_ids: characters.map((c) => c.id),
          character_names: characters.map((c) => c.name),
        },
        screenplay_data: { scenes },
      },
      shots,
      dialogueLines,
      audioTracks,
      audioAssets,
      captions,
      captionSegments,
      characters,
      characterDetails: characters.map((character, index) => ({
        asset_id: character.id,
        role: CHARACTERS[index]!.role,
        elevenlabs_voice_id: CHARACTERS[index]!.voice,
        reference_images: [
          media(
            'project-assets',
            `projects/${projectId}/assets/characters/${character.name.toLowerCase()}-ref.png`,
          ),
        ],
      })),
      shorts,
      dubbedVersions,
      dubbedLines,
      recordedHashes: {
        [characterImage]: createHash('sha256')
          .update(`fixture:${characterImage}`)
          .digest('hex'),
      },
    },
  };
}

/**
 * A YouTube-shaped curve (one point per 5%) with a hand-placed drop at 0
 * to 5% (the intro), 30 to 35% and 70 to 75%. The expected hints are
 * hand-computed in `edit-package-fixtures.test.ts`.
 */
export const RETENTION_CURVE = Array.from({ length: 21 }, (_, index) => {
  const ratio = index / 20;
  let watch = 1 - ratio * 0.3;

  if (ratio >= 0.05) watch -= 0.12;
  if (ratio >= 0.35) watch -= 0.08;
  if (ratio >= 0.75) watch -= 0.1;

  return {
    elapsedRatio: Number(ratio.toFixed(2)),
    audienceWatchRatio: Number(watch.toFixed(4)),
  };
});
