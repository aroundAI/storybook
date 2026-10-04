import { Scissors } from 'lucide-react';

import type { EditStyle } from '../lib/edit-style';
import { formatClock } from '../lib/format';

/**
 * Edit style (FILM-2006, PRD R-72): how the episode's latest delivered
 * StorybookStudio edit was cut — cut density, average shot length, hook
 * type and the AI's share of the operations — shown beside retention so
 * the two can be read together. Each figure comes from `deriveEditStyle`;
 * one the delivery did not record says so, and is never shown as 0.
 * Nothing here claims the cut caused the retention: it is the record of
 * how the video was made, next to how it was watched.
 */
export function EditStyleCard(props: {
  style: EditStyle;
  /** ISO 8601 */
  deliveredAt: string;
}) {
  const { style } = props;

  return (
    <section
      className="flex flex-col gap-3 rounded-lg border bg-card p-4"
      data-test="edit-style-card"
    >
      <header className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <Scissors className="h-4 w-4" aria-hidden="true" />
          Edit style
        </h3>
        <p className="text-xs text-muted-foreground">
          From the StorybookStudio delivery of{' '}
          <time dateTime={props.deliveredAt} suppressHydrationWarning>
            {new Date(props.deliveredAt).toLocaleDateString()}
          </time>
        </p>
      </header>

      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Figure
          label="Cut density"
          test="edit-style-cut-density"
          value={
            style.cutsPerMinute === null
              ? null
              : `${formatNumber(style.cutsPerMinute)} cuts/min`
          }
          detail={
            style.cutCount === null
              ? null
              : `${style.cutCount} ${style.cutCount === 1 ? 'cut' : 'cuts'} in ${formatClock(style.finalDuration)}`
          }
        />
        <Figure
          label="Average shot length"
          test="edit-style-shot-length"
          value={
            style.avgShotLength === null
              ? null
              : `${formatNumber(style.avgShotLength)} s`
          }
        />
        <Figure
          label="Hook type"
          test="edit-style-hook"
          value={style.hookType}
        />
        <Figure
          label="AI share"
          test="edit-style-ai-share"
          value={
            style.aiShare === null
              ? null
              : `${Math.round(style.aiShare * 100)}%`
          }
          detail={`${style.aiOps} AI · ${style.userOps} by hand`}
        />
      </dl>
    </section>
  );
}

function Figure(props: {
  label: string;
  test: string;
  value: string | null;
  detail?: string | null;
}) {
  return (
    <div className="flex flex-col gap-0.5" data-test={props.test}>
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd
        className={
          props.value === null
            ? 'text-sm text-muted-foreground'
            : 'text-lg font-semibold tabular-nums'
        }
        data-test={`${props.test}-value`}
      >
        {props.value ?? 'Not recorded'}
      </dd>
      {props.detail ? (
        <dd className="text-xs text-muted-foreground">{props.detail}</dd>
      ) : null}
    </div>
  );
}

function formatNumber(value: number) {
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}
