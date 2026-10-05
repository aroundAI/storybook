import { createHash } from 'node:crypto';

import {
  type AnalyticsHints,
  EDIT_PACKAGE_SCHEMA_ID,
  EDIT_PACKAGE_URL_TTL_SECONDS,
  type EditPackage,
  type EditPackageAudioTrack,
  type EditPackageCaptionTrack,
  type EditPackageCharacter,
  type EditPackageDialogueLine,
  type EditPackageDubbedLanguage,
  type EditPackageEpisode,
  type EditPackageScene,
  type EditPackageShortsCandidate,
  type EditPackageShot,
  type MediaEntry,
  PrimarySubjectSchema,
} from './edit-package.schema';
import { readStoredBrand, readStoredEditPolicy } from './project-settings';

/**
 * FILM-2001: the edit package as a pure function of the rows it is built
 * from. No I/O: the server loader (`server/load-edit-package.ts`) reads the
 * rows with the caller's RLS client and resolves the media first, and the
 * fixtures (`fixtures/edit-package/`) are this function over seeded rows.
 */

type Json = unknown;

export interface ProjectSourceRow {
  id: string;
  name: string;
  slug: string | null;
  brand: Json;
  edit_policy: Json;
}

export interface EpisodeSourceRow {
  id: string;
  project_id: string;
  number: number;
  title: string;
  status: string;
  version: number;
  target_duration_seconds: number | null;
  metadata: Json;
  screenplay_data: Json;
}

export interface ShotSourceRow {
  id: string;
  scene_number: number | null;
  shot_number: number | null;
  sequence_number: number;
  status: string;
  duration_seconds: number;
  source_duration: number | null;
  timeline_start_seconds: number | null;
  trim_in_point: number | null;
  trim_out_point: number | null;
  transition_type: string | null;
  prompt: string;
  action_description: string | null;
  camera_direction: string | null;
  primary_subject: Json;
  continuation_from_shot_id: string | null;
  inherit_last_frame: boolean | null;
  shorts_candidate: boolean | null;
  video_url: string | null;
  first_frame_url: string | null;
  last_frame_url: string | null;
}

export interface DialogueSourceRow {
  id: string;
  shot_id: string | null;
  scene_number: number | null;
  sequence_number: number;
  character_name: string | null;
  character_asset_id: string | null;
  text: string;
  emotion: string | null;
  language: string;
  timeline_start_seconds: number | null;
  estimated_duration_seconds: number | null;
  status: string;
  audio_url: string | null;
}

export interface AudioTrackSourceRow {
  id: string;
  type: string;
  name: string | null;
  file_url: string | null;
  duration_seconds: number | null;
  timeline_start_seconds: number;
  volume: number;
  metadata: Json;
  audio_asset_id: string | null;
}

export interface AudioAssetSourceRow {
  id: string;
  file_url: string | null;
  is_loopable: boolean | null;
  tags: string[] | null;
}

export interface CaptionSourceRow {
  id: string;
  language: string;
  status: string;
  style_preset: string;
}

export interface CaptionSegmentSourceRow {
  id: string;
  caption_id: string;
  sequence_number: number;
  start_time: number;
  end_time: number;
  text: string;
  speaker_id: string | null;
}

export interface CharacterAssetSourceRow {
  id: string;
  name: string;
  description: string | null;
  file_url: string | null;
  metadata: Json;
}

export interface CharacterDetailSourceRow {
  asset_id: string;
  role: string | null;
  elevenlabs_voice_id: string | null;
  reference_images: string[] | null;
}

export interface ShortSourceRow {
  id: string;
  start_seconds: number;
  end_seconds: number;
  duration_seconds: number | null;
  viral_score: number | null;
  hook_type: string | null;
  title: string | null;
  source_shot_id: string | null;
  status: string;
}

export interface DubbedVersionSourceRow {
  id: string;
  language: string;
  status: string;
}

export interface DubbedLineSourceRow {
  id: string;
  dubbed_version_id: string;
  original_dialogue_id: string;
  translated_text: string;
  timing_adjustment: number;
  timeline_start_seconds: number | null;
  duration_seconds: number | null;
  status: string;
  audio_url: string | null;
}

/** Every row a package is built from, as read under the caller's RLS. */
export interface EditPackageSources {
  project: ProjectSourceRow;
  episode: EpisodeSourceRow;
  shots: ShotSourceRow[];
  dialogueLines: DialogueSourceRow[];
  audioTracks: AudioTrackSourceRow[];
  audioAssets: AudioAssetSourceRow[];
  captions: CaptionSourceRow[];
  captionSegments: CaptionSegmentSourceRow[];
  characters: CharacterAssetSourceRow[];
  characterDetails: CharacterDetailSourceRow[];
  shorts: ShortSourceRow[];
  dubbedVersions: DubbedVersionSourceRow[];
  dubbedLines: DubbedLineSourceRow[];
  /**
   * Stored URL → the SHA-256 recorded when the file was written
   * (`media_checksums`, KB-189), or `assets.file_hash`.
   */
  recordedHashes: Record<string, string>;
}

/** Looks up the resolved entry for a stored media URL (or none). */
export type MediaLookup = (storedUrl: string | null) => MediaEntry;

const DEFAULT_ASPECT = '16:9';
const DEFAULT_FPS = 24;
const DEFAULT_LANGUAGE = 'en';

function record(value: Json): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === 'string' ? Number(value) : value;

  return typeof number === 'number' && Number.isFinite(number) ? number : null;
}

function nonNegative(value: unknown): number | null {
  const number = finiteNumber(value);

  return number !== null && number >= 0 ? number : null;
}

function byNumberThenId<T extends { id: string }>(
  number: (row: T) => number,
): (a: T, b: T) => number {
  return (a, b) => number(a) - number(b) || a.id.localeCompare(b.id);
}

/** Every media URL a package names, distinct, in a stable order. */
export function collectMediaUrls(sources: EditPackageSources): string[] {
  const audioAssets = new Map(sources.audioAssets.map((a) => [a.id, a]));
  const details = new Map(sources.characterDetails.map((d) => [d.asset_id, d]));
  const urls = [
    ...sources.shots.flatMap((s) => [
      s.video_url,
      s.first_frame_url,
      s.last_frame_url,
    ]),
    ...sources.dialogueLines.map((d) => d.audio_url),
    ...sources.audioTracks.map(
      (t) =>
        t.file_url ??
        (t.audio_asset_id ? audioAssets.get(t.audio_asset_id)?.file_url : null),
    ),
    ...sources.characters.flatMap((c) => [
      c.file_url,
      ...(details.get(c.id)?.reference_images ?? []),
    ]),
    ...sources.dubbedLines.map((l) => l.audio_url),
  ];

  return Array.from(new Set(urls.filter((url): url is string => Boolean(url))));
}

function episodeBlock(sources: EditPackageSources): EditPackageEpisode {
  const { episode } = sources;
  const metadata = record(episode.metadata);

  const counts = new Map<string, number>();
  for (const line of sources.dialogueLines) {
    counts.set(line.language, (counts.get(line.language) ?? 0) + 1);
  }

  const ranked = [...counts.entries()].sort(
    ([a, countA], [b, countB]) => countB - countA || a.localeCompare(b),
  );
  const language =
    ranked[0]?.[0] ?? text(metadata.language) ?? DEFAULT_LANGUAGE;

  const others = new Set<string>([
    ...counts.keys(),
    ...sources.captions.map((c) => c.language),
    ...sources.dubbedVersions.map((v) => v.language),
  ]);
  others.delete(language);

  const aspect = text(metadata.aspect_ratio) ?? text(metadata.aspectRatio);
  const fps = finiteNumber(metadata.fps);
  const target =
    finiteNumber(episode.target_duration_seconds) ??
    finiteNumber(metadata.target_duration);

  return {
    id: episode.id,
    projectId: episode.project_id,
    number: episode.number,
    title: episode.title,
    status: episode.status,
    version: episode.version,
    targetDurationSeconds: target !== null && target > 0 ? target : null,
    aspect: aspect && /^\d+:\d+$/.test(aspect) ? aspect : DEFAULT_ASPECT,
    fps: fps !== null && fps > 0 ? fps : DEFAULT_FPS,
    language,
    languages: [language, ...[...others].sort()],
  };
}

/**
 * Scenes as stored in `screenplay_data.scenes`. Generations over time wrote
 * `number` or `sceneNumber`, `heading` or `title`, `estimatedDuration` or
 * `duration`; each is read by every name it has had.
 */
function scenes(screenplay: Json): EditPackageScene[] {
  const stored = record(screenplay).scenes;

  if (!Array.isArray(stored)) return [];

  return stored.map((raw, index) => {
    const scene = record(raw);
    const number =
      finiteNumber(scene.number) ?? finiteNumber(scene.sceneNumber);
    const dialogue = Array.isArray(scene.dialogue) ? scene.dialogue : [];

    return {
      number: number !== null ? Math.trunc(number) : index + 1,
      heading:
        text(scene.heading) ??
        text(scene.title) ??
        text(scene.location) ??
        `Scene ${index + 1}`,
      description: text(scene.description),
      location: text(scene.location),
      timeOfDay: text(scene.timeOfDay),
      characters: Array.isArray(scene.characters)
        ? scene.characters.filter((c): c is string => typeof c === 'string')
        : [],
      estimatedDurationSeconds:
        nonNegative(scene.estimatedDuration) ?? nonNegative(scene.duration),
      dialogue: dialogue.flatMap((line) => {
        const entry = record(line);
        const said = text(entry.text) ?? text(entry.line);

        return said
          ? [{ character: text(entry.character) ?? null, text: said }]
          : [];
      }),
    };
  });
}

function shots(
  sources: EditPackageSources,
  media: MediaLookup,
): EditPackageShot[] {
  return [...sources.shots]
    .sort(byNumberThenId((s) => s.sequence_number))
    .map((shot) => {
      const subject = PrimarySubjectSchema.safeParse(shot.primary_subject);

      return {
        id: shot.id,
        sceneNumber: shot.scene_number,
        shotNumber: shot.shot_number,
        sequenceNumber: shot.sequence_number,
        status: shot.status,
        durationSeconds: nonNegative(shot.duration_seconds) ?? 0,
        sourceDurationSeconds: nonNegative(shot.source_duration),
        timelineStartSeconds: nonNegative(shot.timeline_start_seconds),
        trimInSeconds: nonNegative(shot.trim_in_point),
        trimOutSeconds: nonNegative(shot.trim_out_point),
        transitionType: shot.transition_type,
        prompt: shot.prompt,
        actionDescription: shot.action_description,
        cameraDirection: shot.camera_direction,
        primarySubject: subject.success ? subject.data : null,
        continuationFromShotId: shot.continuation_from_shot_id,
        inheritLastFrame: shot.inherit_last_frame ?? false,
        shortsCandidate: shot.shorts_candidate ?? false,
        video: media(shot.video_url),
        firstFrame: media(shot.first_frame_url),
        lastFrame: media(shot.last_frame_url),
      };
    });
}

function dialogue(
  sources: EditPackageSources,
  media: MediaLookup,
): EditPackageDialogueLine[] {
  return [...sources.dialogueLines]
    .sort(byNumberThenId((d) => d.sequence_number))
    .map((line) => ({
      id: line.id,
      shotId: line.shot_id,
      sceneNumber: line.scene_number,
      sequenceNumber: line.sequence_number,
      characterName: line.character_name,
      characterAssetId: line.character_asset_id,
      text: line.text,
      emotion: line.emotion,
      language: line.language,
      timelineStartSeconds: nonNegative(line.timeline_start_seconds),
      estimatedDurationSeconds: nonNegative(line.estimated_duration_seconds),
      status: line.status,
      audio: media(line.audio_url),
    }));
}

const TRACK_TYPES: Record<string, EditPackageAudioTrack['type']> = {
  music: 'music',
  sfx: 'sfx',
  ambient: 'ambience',
};

/**
 * Music, SFX and ambience. `dialogue_composite` tracks are left out: they
 * are a mix of the dialogue lines the package already carries one by one.
 */
function audioTracks(
  sources: EditPackageSources,
  media: MediaLookup,
): EditPackageAudioTrack[] {
  const assets = new Map(sources.audioAssets.map((a) => [a.id, a]));

  return [...sources.audioTracks]
    .sort(
      (a, b) =>
        a.timeline_start_seconds - b.timeline_start_seconds ||
        a.id.localeCompare(b.id),
    )
    .flatMap((track) => {
      const type = TRACK_TYPES[track.type];

      if (!type) return [];

      const asset = track.audio_asset_id
        ? (assets.get(track.audio_asset_id) ?? null)
        : null;
      const metadata = record(track.metadata);

      return [
        {
          id: track.id,
          type,
          name: track.name,
          timelineStartSeconds: nonNegative(track.timeline_start_seconds) ?? 0,
          durationSeconds: nonNegative(track.duration_seconds),
          volume: Math.min(2, Math.max(0, finiteNumber(track.volume) ?? 1)),
          loopable:
            asset?.is_loopable ??
            (typeof metadata.loopable === 'boolean'
              ? metadata.loopable
              : false),
          tags: asset?.tags ?? [],
          audioAssetId: track.audio_asset_id,
          media: media(track.file_url ?? asset?.file_url ?? null),
        },
      ];
    });
}

function captions(sources: EditPackageSources): EditPackageCaptionTrack[] {
  const segments = new Map<string, CaptionSegmentSourceRow[]>();

  for (const segment of sources.captionSegments) {
    const list = segments.get(segment.caption_id) ?? [];
    list.push(segment);
    segments.set(segment.caption_id, list);
  }

  return [...sources.captions]
    .sort(
      (a, b) =>
        a.language.localeCompare(b.language) || a.id.localeCompare(b.id),
    )
    .map((caption) => ({
      language: caption.language,
      captionId: caption.id,
      status: caption.status,
      stylePreset: caption.style_preset,
      segments: (segments.get(caption.id) ?? [])
        .sort(byNumberThenId((s) => s.sequence_number))
        .map((segment) => ({
          id: segment.id,
          sequenceNumber: segment.sequence_number,
          startSeconds: nonNegative(segment.start_time) ?? 0,
          endSeconds: nonNegative(segment.end_time) ?? 0,
          text: segment.text,
          speakerId: segment.speaker_id,
        })),
    }));
}

function characters(
  sources: EditPackageSources,
  media: MediaLookup,
): EditPackageCharacter[] {
  const details = new Map(sources.characterDetails.map((d) => [d.asset_id, d]));

  return [...sources.characters]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((character) => {
      const detail = details.get(character.id);
      const metadata = record(character.metadata);
      const images = Array.from(
        new Set(
          [character.file_url, ...(detail?.reference_images ?? [])].filter(
            (url): url is string => Boolean(url),
          ),
        ),
      );

      return {
        assetId: character.id,
        name: character.name,
        role: detail?.role ?? text(metadata.role),
        description: character.description,
        voiceId: detail?.elevenlabs_voice_id ?? null,
        referenceImages: images.map((url) => media(url)),
      };
    });
}

function shortsCandidates(
  sources: EditPackageSources,
): EditPackageShortsCandidate[] {
  return [...sources.shorts]
    .sort(
      (a, b) => a.start_seconds - b.start_seconds || a.id.localeCompare(b.id),
    )
    .map((short) => ({
      id: short.id,
      startSeconds: nonNegative(short.start_seconds) ?? 0,
      endSeconds: nonNegative(short.end_seconds) ?? 0,
      durationSeconds: nonNegative(short.duration_seconds),
      viralScore: finiteNumber(short.viral_score),
      hookType: short.hook_type,
      title: short.title,
      sourceShotId: short.source_shot_id,
      status: short.status,
    }));
}

function dubbed(
  sources: EditPackageSources,
  media: MediaLookup,
): EditPackageDubbedLanguage[] {
  const order = new Map(
    sources.dialogueLines.map((line) => [line.id, line.sequence_number]),
  );
  const lines = new Map<string, DubbedLineSourceRow[]>();

  for (const line of sources.dubbedLines) {
    const list = lines.get(line.dubbed_version_id) ?? [];
    list.push(line);
    lines.set(line.dubbed_version_id, list);
  }

  return [...sources.dubbedVersions]
    .sort(
      (a, b) =>
        a.language.localeCompare(b.language) || a.id.localeCompare(b.id),
    )
    .map((version) => ({
      language: version.language,
      dubbedVersionId: version.id,
      status: version.status,
      lines: (lines.get(version.id) ?? [])
        .sort(
          (a, b) =>
            (order.get(a.original_dialogue_id) ?? Number.MAX_SAFE_INTEGER) -
              (order.get(b.original_dialogue_id) ?? Number.MAX_SAFE_INTEGER) ||
            a.id.localeCompare(b.id),
        )
        .map((line) => ({
          id: line.id,
          dialogueId: line.original_dialogue_id,
          translatedText: line.translated_text,
          timingAdjustment: finiteNumber(line.timing_adjustment) ?? 1,
          timelineStartSeconds: nonNegative(line.timeline_start_seconds),
          durationSeconds: nonNegative(line.duration_seconds),
          status: line.status,
          audio: media(line.audio_url),
        })),
    }));
}

/** Everything in a package except its etag, timestamps and analytics. */
function packageContent(sources: EditPackageSources, media: MediaLookup) {
  return {
    project: {
      id: sources.project.id,
      name: sources.project.name,
      slug: sources.project.slug,
    },
    episode: episodeBlock(sources),
    scenes: scenes(sources.episode.screenplay_data),
    shots: shots(sources, media),
    dialogue: dialogue(sources, media),
    audioTracks: audioTracks(sources, media),
    captions: captions(sources),
    characters: characters(sources, media),
    shortsCandidates: shortsCandidates(sources),
    dubbed: dubbed(sources, media),
    brand: readStoredBrand(sources.project.brand).value,
    editPolicy: readStoredEditPolicy(sources.project.edit_policy).value,
  };
}

/** JSON with every object's keys sorted, so equal content hashes equally. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`,
      )
      .join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
}

/**
 * The package's etag: `v<episodes.version>-<sha1>` over everything the
 * timeline is built from, as stored. Media count by the URL a row names and
 * the hash recorded for it, never by the signed URL (which differs on every
 * call). Signed URLs, timestamps and analytics hints are left out, so a new
 * day of analytics does not make the Studio re-sync.
 *
 * Content rather than max(updated_at): `dialogue_lines` and `audio_tracks`
 * have no updated_at, and a hard-deleted row moves no timestamp at all.
 */
export function editPackageEtag(sources: EditPackageSources): string {
  const asStored = ((url: string | null) => ({
    stored: url,
    sha256: url ? (sources.recordedHashes[url] ?? null) : null,
  })) as unknown as MediaLookup;

  const digest = createHash('sha1')
    .update(canonicalJson(packageContent(sources, asStored)))
    .digest('hex');

  return `v${sources.episode.version}-${digest}`;
}

export interface BuildEditPackageInput {
  sources: EditPackageSources;
  /** The entry for each stored URL, from `collectMediaUrls`. */
  media: MediaLookup;
  analyticsHints: AnalyticsHints;
  generatedAt: Date;
  /** Computed once by the caller that already compared it; else here. */
  etag?: string;
}

/** The edit package. Validate with EditPackageSchema at the boundary. */
export function buildEditPackage({
  sources,
  media,
  analyticsHints,
  generatedAt,
  etag,
}: BuildEditPackageInput): EditPackage {
  return {
    schemaId: EDIT_PACKAGE_SCHEMA_ID,
    etag: etag ?? editPackageEtag(sources),
    generatedAt: generatedAt.toISOString(),
    urlsExpireAt: new Date(
      generatedAt.getTime() + EDIT_PACKAGE_URL_TTL_SECONDS * 1000,
    ).toISOString(),
    ...packageContent(sources, media),
    analyticsHints,
  };
}
