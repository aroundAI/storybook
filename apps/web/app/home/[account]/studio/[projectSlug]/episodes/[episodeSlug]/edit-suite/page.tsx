'use client';

/**
 * Edit Suite page — per-episode non-linear editor.
 *
 * Wraps the editor in EditSuiteProvider and renders the shell layout.
 * On first open, loads the existing edit project or shows a creation CTA.
 */
import dynamic from 'next/dynamic';

import { useEpisodeContext } from '../_components/episode-context-provider';

const EditSuiteProvider = dynamic(
  () =>
    import('@kit/edit-suite/components').then((mod) => ({
      default: mod.EditSuiteProvider,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="animate-pulse p-8">
        <div className="h-8 w-48 rounded-lg bg-gray-200 dark:bg-[#1A1A1A]" />
        <div className="mt-4 h-64 rounded-xl bg-gray-100 dark:bg-[#1A1A1A]" />
      </div>
    ),
  },
);

const EditSuiteShell = dynamic(
  () =>
    import('@kit/edit-suite/components').then((mod) => ({
      default: mod.EditSuiteShell,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="animate-pulse p-8">
        <div className="h-8 w-48 rounded-lg bg-gray-200 dark:bg-[#1A1A1A]" />
        <div className="mt-4 h-96 rounded-xl bg-gray-100 dark:bg-[#1A1A1A]" />
      </div>
    ),
  },
);

export default function EditSuitePage() {
  const { episode } = useEpisodeContext();

  return (
    <EditSuiteProvider episodeId={episode.id}>
      <EditSuiteShell />
    </EditSuiteProvider>
  );
}
