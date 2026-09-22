'use client';

import type { LanguageDimension } from '@kit/clickhouse';

import { LANGUAGE_DIMENSION_LABELS } from '../lib/language-labels';

/**
 * Names the language dimension a card is grouped by (FILM-1702).
 *
 * On every card that breaks figures down by language, not only beside the
 * toggle: a card is read — and screenshotted — on its own, and "Spanish 40%"
 * means a different thing under each setting.
 */
export function LanguageDimensionLabel({
  dimension,
  card,
}: {
  dimension: LanguageDimension;
  /** Distinguishes the labels for a test; one per card. */
  card: string;
}) {
  return (
    <p
      className="text-xs font-normal text-muted-foreground"
      data-test={`language-dimension-label-${card}`}
    >
      By {LANGUAGE_DIMENSION_LABELS[dimension].toLowerCase()}
    </p>
  );
}
