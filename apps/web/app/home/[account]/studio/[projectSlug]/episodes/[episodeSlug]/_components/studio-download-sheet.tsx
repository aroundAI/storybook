'use client';

import Image from 'next/image';
import Link from 'next/link';

import { Apple, ExternalLink, KeyRound, MonitorDown } from 'lucide-react';

import { Button } from '@kit/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@kit/ui/sheet';

import studioDownloadConfig from '~/config/studio-download.config';

/**
 * What "Open in Studio" shows when no app answered the link (FILM-2005):
 * the macOS and Windows downloads, the personal access token alternative
 * for a Studio that cannot use the browser sign-in, and more about the app.
 */
export function StudioDownloadSheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountSlug: string;
}) {
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent data-test="studio-download-sheet">
        <SheetHeader className="space-y-3">
          <Image
            src="/images/storybookstudio-icon.png"
            alt=""
            width={48}
            height={48}
            className="rounded-xl"
          />
          <SheetTitle>StorybookStudio did not open</SheetTitle>
          <SheetDescription>
            StorybookStudio is the desktop editor for StoryBook episodes. If it
            is not installed on this computer, download it, open it once, and
            press &ldquo;Open in Studio&rdquo; again.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-3">
          <Button asChild className="w-full justify-start gap-2">
            <a
              href={studioDownloadConfig.macosUrl}
              target="_blank"
              rel="noreferrer"
              data-test="studio-download-macos"
            >
              <Apple className="h-4 w-4" aria-hidden="true" />
              Download for macOS
            </a>
          </Button>
          <Button
            asChild
            variant="outline"
            className="w-full justify-start gap-2"
          >
            <a
              href={studioDownloadConfig.windowsUrl}
              target="_blank"
              rel="noreferrer"
              data-test="studio-download-windows"
            >
              <MonitorDown className="h-4 w-4" aria-hidden="true" />
              Download for Windows
            </a>
          </Button>
        </div>

        <div className="mt-6 space-y-2 rounded-lg border p-4 text-sm">
          <p className="font-medium">Signing in without the browser</p>
          <p className="text-muted-foreground">
            Create a personal access token and paste it into StorybookStudio
            instead.
          </p>
          <Button asChild variant="link" className="h-auto gap-1.5 p-0">
            <Link
              href={`/home/${props.accountSlug}/settings/connected-apps`}
              data-test="studio-download-token"
            >
              <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
              Create a token
            </Link>
          </Button>
        </div>

        <Button asChild variant="link" className="mt-4 h-auto gap-1.5 p-0">
          <a
            href={studioDownloadConfig.learnMoreUrl}
            target="_blank"
            rel="noreferrer"
            data-test="studio-download-learn-more"
          >
            Learn more about StorybookStudio
            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
          </a>
        </Button>
      </SheetContent>
    </Sheet>
  );
}
