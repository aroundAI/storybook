/**
 * The largest video StoryBook takes (FILM-2212): an episode video or Short
 * on the Publish screen, a shot video, a video asset, and an MCP upload
 * (`request_episode_video_upload`, `request_render_upload`). Every site
 * reads it from here; a guard fails if one inlines a number again.
 *
 * It is what one presigned PUT to R2 can carry: R2 takes at most 5 GiB
 * less 5 MiB in a single-part upload
 * (https://developers.cloudflare.com/r2/platform/limits/). The rest of the
 * path takes it: finalize only reads the object's size, the YouTube worker
 * streams the file through, and Facebook and Instagram fetch it from its
 * URL. Their own limits are lower and are checked when a publish is
 * scheduled (`platformVideoRefusal`), not at upload.
 */
export const MAX_VIDEO_UPLOAD_BYTES = 5 * 1024 ** 3 - 5 * 1024 ** 2;

/** A byte count as people read it: `4.99 GB`, `300 MB`. */
export function formatUploadSize(bytes: number): string {
  if (bytes >= 1024 ** 3) {
    return `${Math.floor((bytes / 1024 ** 3) * 100) / 100} GB`;
  }

  return `${Math.floor(bytes / 1024 ** 2)} MB`;
}
