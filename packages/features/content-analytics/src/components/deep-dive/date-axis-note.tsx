'use client';

import { useState } from 'react';

import { X } from 'lucide-react';

import type { AnalyticsPlatform } from '@kit/clickhouse';
import { Alert, AlertDescription, AlertTitle } from '@kit/ui/alert';
import { Button } from '@kit/ui/button';

import { platformLabel } from '../../lib/platform-labels';
import { TRUE_DAILY_PLATFORMS } from '../../lib/row-dating';

/**
 * Per viewer, in this browser: the note is a one-off explanation of a
 * release, not state anyone else needs, and it need not outlive a release
 * or two (FILM-1707 §2).
 */
export const DATE_AXIS_NOTE_KEY = 'analytics.deep-dive.date-axis-note.dismissed';

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DATE_AXIS_NOTE_KEY) === '1';
  } catch {
    return false;
  }
}

function list(names: readonly string[]): string {
  if (names.length <= 1) return names.join('');

  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/**
 * "The numbers moved" (FILM-1707 §2). For a project that publishes to a
 * fetch-dated platform, the median, rolling, back-catalog and cohort
 * figures changed the day this shipped: they used to mix daily views with
 * running totals dated to the day we fetched them. Said once, dismissibly,
 * rather than silently.
 */
export function DateAxisNote({
  excluded,
}: {
  /** The fetch-dated platforms this project publishes to. Nothing shows when empty. */
  excluded: readonly AnalyticsPlatform[];
}) {
  // Read lazily on mount: the tab renders on the client after a click, and
  // storage that throws (private mode, blocked site data) means "not
  // dismissed" rather than a crash.
  const [dismissed, setDismissed] = useState(readDismissed);

  if (dismissed || excluded.length === 0) return null;

  const left = list(excluded.map(platformLabel));
  const kept = list(TRUE_DAILY_PLATFORMS.map(platformLabel));

  const dismiss = () => {
    setDismissed(true);

    try {
      window.localStorage.setItem(DATE_AXIS_NOTE_KEY, '1');
    } catch {
      // Dismissed for this visit; it may show again next time.
    }
  };

  return (
    <Alert data-test={'deep-dive-date-axis-note'}>
      <AlertTitle className={'flex items-start justify-between gap-2'}>
        <span>These figures changed</span>
        <Button
          variant={'ghost'}
          size={'icon'}
          className={'-mt-1 size-6'}
          aria-label={'Dismiss this note'}
          onClick={dismiss}
          data-test={'deep-dive-date-axis-note-dismiss'}
        >
          <X className={'size-4'} />
        </Button>
      </AlertTitle>
      <AlertDescription className={'flex flex-col gap-1'}>
        <span>
          Median views, rolling views, back catalog and upload cohorts are drawn
          on a date axis, and now use {kept} only. {left}{' '}
          {excluded.length === 1 ? 'reports' : 'report'} running totals, which
          we can only date to the day we checked, so a gap between checks put
          those views in the wrong week or month — the figures shown here
          before mixed the two.
        </span>
        <span>
          Totals over a video’s life still include every platform, because the
          day a change was recorded on cannot move a total.
        </span>
      </AlertDescription>
    </Alert>
  );
}
