/**
 * KB-197. The thumbnail a publish sends: a long video's own, else the
 * episode's; a Short or Reel none, so the platform shows a frame of it.
 *
 * The episode's thumbnail is cut for the 16:9 long video, and the YouTube
 * and Facebook uploads set whatever they are given, so a Short used to go
 * out wearing it. A Short's own value is ignored too: a row written before
 * this fix still carries the episode's.
 *
 * Environment-free: the Publish screen, the schedule services, the scheduled
 * Lambda and the in-process job all import it.
 */
export function publishThumbnail(
  contentType: string | null | undefined,
  own: string | null | undefined,
  episodeThumbnail: string | null | undefined,
): string | null {
  if (contentType === 'short') return null;

  return own || episodeThumbnail || null;
}
