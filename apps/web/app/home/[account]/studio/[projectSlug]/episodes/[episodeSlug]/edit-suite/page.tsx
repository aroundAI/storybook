'use client';

/**
 * Edit Suite page — per-episode non-linear editor.
 *
 * Wraps the editor in EditSuiteProvider and renders the shell layout.
 * On first open, loads the existing edit project or shows a creation CTA.
 */
import { EditSuiteProvider } from '@kit/edit-suite/components';
import { EditSuiteShell } from '@kit/edit-suite/components';

import { useEpisodeContext } from '../_components/episode-context-provider';

export default function EditSuitePage() {
  const { episode } = useEpisodeContext();

  return (
    <EditSuiteProvider episodeId={episode.id}>
      <EditSuiteShell />
    </EditSuiteProvider>
  );
}
