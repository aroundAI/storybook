/**
 * Where the export dialog uploads a rendered video.
 *
 * On R2 the storage adapter treats this as a key prefix inside the one
 * `R2_BUCKET_NAME` bucket, not as a bucket of its own. The presign route
 * accepts it alongside `project-assets` (KB-28), and reads it from here so
 * the two cannot drift.
 */
export const EXPORT_UPLOAD_BUCKET =
  process.env.NEXT_PUBLIC_R2_BUCKET_NAME ?? 'storybook-assets';
