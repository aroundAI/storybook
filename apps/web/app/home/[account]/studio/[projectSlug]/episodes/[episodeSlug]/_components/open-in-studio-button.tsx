'use client';

import { createContext, useContext, useState } from 'react';

import { MonitorUp } from 'lucide-react';

import { canOpenInStudio, studioOpenLink } from '@kit/desktop-integration';
import { Button } from '@kit/ui/button';

import { useEpisodeContext } from './episode-context-provider';
import { StudioDownloadSheet } from './studio-download-sheet';

/** How long the page waits for the OS to hand the link to the Studio. */
export const NO_HANDLER_TIMEOUT_MS = 2_000;

const DesktopIntegrationContext = createContext(false);

/**
 * The team's `account_ai_settings.desktop_integration_enabled` (FILM-2005),
 * read once by the episode layout for every "Open in Studio" below it.
 */
export function DesktopIntegrationProvider(props: {
  enabled: boolean;
  children: React.ReactNode;
}) {
  return (
    <DesktopIntegrationContext.Provider value={props.enabled}>
      {props.children}
    </DesktopIntegrationContext.Provider>
  );
}

/**
 * "Open in Studio" (FILM-2005): shown when the team turned StorybookStudio
 * on and the episode is in storyboard, generating, ready or published.
 * A click hands `velorn://open?api=<origin>&episode=<id>` to the OS; the
 * link carries no token or session, so the Studio signs in by itself. If
 * the page is still in front 2 s later, nothing answered, and the download
 * sheet opens.
 */
export function OpenInStudioButton() {
  const enabled = useContext(DesktopIntegrationContext);
  const { episode, accountSlug } = useEpisodeContext();
  const [state, setState] = useState<{
    sheetOpen: boolean;
    link: string | null;
  }>({ sheetOpen: false, link: null });

  if (!enabled || !canOpenInStudio(episode.status)) return null;

  const open = () => {
    const link = studioOpenLink({
      origin: window.location.origin,
      episodeId: episode.id,
    });
    let handedOff = false;
    const leave = () => {
      handedOff = true;
    };
    const hide = () => {
      if (document.visibilityState === 'hidden') handedOff = true;
    };

    window.addEventListener('blur', leave);
    document.addEventListener('visibilitychange', hide);
    setState((current) => ({ ...current, link }));

    window.location.assign(link);

    window.setTimeout(() => {
      window.removeEventListener('blur', leave);
      document.removeEventListener('visibilitychange', hide);

      if (!handedOff && document.visibilityState === 'visible') {
        setState((current) => ({ ...current, sheetOpen: true }));
      }
    }, NO_HANDLER_TIMEOUT_MS);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={open}
        data-test="open-in-studio-button"
        data-deep-link={state.link ?? undefined}
      >
        <MonitorUp className="h-4 w-4" aria-hidden="true" />
        Open in Studio
      </Button>

      <StudioDownloadSheet
        open={state.sheetOpen}
        onOpenChange={(sheetOpen) =>
          setState((current) => ({ ...current, sheetOpen }))
        }
        accountSlug={accountSlug}
      />
    </>
  );
}
