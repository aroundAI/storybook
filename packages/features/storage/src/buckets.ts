/**
 * Every storage target the app writes, in one place (KB-55).
 *
 * On the Supabase provider each name is a bucket, and a migration must create
 * it; on R2 each name is a key prefix inside the one `R2_BUCKET_NAME` bucket.
 * `apps/web/app/api/storage/__tests__/storage-buckets.test.ts` fails if a name
 * here has no migration, if a migration's MIME list differs from the one
 * below, or if code passes a bucket name that is not in this list.
 *
 * Constants only, so client and server code can both import it.
 */
export const STORAGE_BUCKETS = {
  projectAssets: 'project-assets',
  accountImage: 'account_image',
  audio: 'audio',
  audioAssets: 'audio-assets',
  reports: 'reports',
} as const;

export type StorageBucket =
  (typeof STORAGE_BUCKETS)[keyof typeof STORAGE_BUCKETS];

/** Generated dialogue, voice previews, SFX and music: always MP3. */
export const AUDIO_BUCKET_TYPES = ['audio/mpeg'] as const;

/** What the audio library accepts from a user's own file. */
export const AUDIO_LIBRARY_TYPES = [
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/mp4',
  'audio/x-m4a',
] as const;

/** Report exports and scheduled reports. */
export const REPORT_TYPES = ['text/csv', 'application/pdf'] as const;

export function isAudioLibraryType(
  contentType: string,
): contentType is (typeof AUDIO_LIBRARY_TYPES)[number] {
  return (AUDIO_LIBRARY_TYPES as readonly string[]).includes(contentType);
}
