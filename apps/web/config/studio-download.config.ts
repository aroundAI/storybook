import { z } from 'zod';

/**
 * Where "Open in Studio" sends someone who does not have StorybookStudio yet
 * (FILM-2005): the macOS and Windows downloads and a page about the app.
 * Each can be set per deployment; unset, they point at the app's releases
 * and README.
 */
const RELEASES = 'https://github.com/aroundAI/storybookstudio/releases/latest';

const StudioDownloadConfigSchema = z.object({
  macosUrl: z.string().url(),
  windowsUrl: z.string().url(),
  learnMoreUrl: z.string().url(),
});

const studioDownloadConfig = StudioDownloadConfigSchema.parse({
  macosUrl: process.env.NEXT_PUBLIC_STUDIO_DOWNLOAD_MACOS_URL || RELEASES,
  windowsUrl: process.env.NEXT_PUBLIC_STUDIO_DOWNLOAD_WINDOWS_URL || RELEASES,
  learnMoreUrl:
    process.env.NEXT_PUBLIC_STUDIO_LEARN_MORE_URL ||
    'https://github.com/aroundAI/storybookstudio#readme',
});

export default studioDownloadConfig;
