import { z } from 'zod';

/**
 * "Open in Studio" (FILM-2005): the episode statuses that offer it, and the
 * deep link it launches. The Studio's protocol handler (FILM-2011) parses
 * the same link: `storybookstudio://open?api=<encoded origin>&episode=<id>`.
 */
export const OPEN_IN_STUDIO_STATUSES = [
  'storyboard',
  'generating',
  'ready',
  'published',
] as const;

export type OpenInStudioStatus = (typeof OPEN_IN_STUDIO_STATUSES)[number];

export function canOpenInStudio(status: string): status is OpenInStudioStatus {
  return (OPEN_IN_STUDIO_STATUSES as readonly string[]).includes(status);
}

export const STUDIO_DEEP_LINK_SCHEME = 'storybookstudio';

const StudioOpenLinkInputSchema = z.object({
  origin: z
    .string()
    .url()
    .refine((value) => /^https?:$/.test(new URL(value).protocol), {
      message: 'The app origin must be http or https.',
    }),
  episodeId: z.string().uuid(),
});

/**
 * The link carries no token and no session: `api` is the app's origin
 * alone (any path, query, fragment or credentials in what it is given are
 * dropped), and the Studio signs in by itself, allowlisting the host.
 */
export function studioOpenLink(input: { origin: string; episodeId: string }) {
  const { origin, episodeId } = StudioOpenLinkInputSchema.parse(input);
  const api = new URL(origin).origin;

  return `${STUDIO_DEEP_LINK_SCHEME}://open?api=${encodeURIComponent(api)}&episode=${encodeURIComponent(episodeId)}`;
}
