'use client';

import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  createContext,
  useContext,
  useState,
} from 'react';

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@kit/ui/tooltip';
import { cn } from '@kit/ui/utils';

/**
 * Hover detail for the Deep Dive's hand-drawn bar charts (FILM-1708).
 *
 * These charts used native `title=` attributes: unstyled, a second's delay,
 * and unreachable from the keyboard. Each mark is now a `@kit/ui/tooltip`
 * trigger, so the detail looks like every other tooltip in the product and
 * opens on focus as well as hover.
 *
 * One tab stop per chart, not one per mark. The traffic breakdown alone has
 * 52 columns of up to eight slices; a tab stop each would put hundreds of
 * stops between the reader and the next card. Arrow keys move inside the
 * chart instead — left and right between columns, up and down through a
 * column's slices — the roving-tabindex pattern a grid uses.
 */

/**
 * A share as a tooltip or drill-down reports it: to one decimal, and never
 * "0%" for a share that is not zero. A slice floored to 2px draws larger
 * than it is, so its label is the one place the true size shows — rounding
 * a 0.4% slice to "0%" would make that label wrong as well.
 */
export function formatTrueShare(share: number) {
  if (share > 0 && share < 0.0005) return '<0.1%';

  return `${(share * 100).toFixed(1)}%`;
}

interface Position {
  col: number;
  row: number;
}

const ActiveMark = createContext<{
  active: Position;
  setActive: (position: Position) => void;
} | null>(null);

const COL = 'data-mark-col';
const ROW = 'data-mark-row';

export function ChartMarks({
  label,
  className,
  style,
  children,
  'data-test': dataTest,
}: {
  /** What the chart shows, announced when focus enters it. */
  label: string;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  'data-test'?: string;
}) {
  const [active, setActive] = useState<Position>({ col: 0, row: 0 });

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = (event.target as HTMLElement).closest(`[${COL}]`);

    if (!from) return;

    const col = Number(from.getAttribute(COL));
    const row = Number(from.getAttribute(ROW));
    const columns = new Set(
      [...event.currentTarget.querySelectorAll(`[${COL}]`)].map((mark) =>
        Number(mark.getAttribute(COL)),
      ),
    );
    const lastCol = Math.max(...columns);
    const rowsIn = (c: number) =>
      event.currentTarget.querySelectorAll(`[${COL}="${c}"]`).length;

    const next: Position | null = (() => {
      switch (event.key) {
        case 'ArrowRight':
          return { col: Math.min(lastCol, col + 1), row };
        case 'ArrowLeft':
          return { col: Math.max(0, col - 1), row };
        case 'ArrowUp':
          return { col, row: Math.min(rowsIn(col) - 1, row + 1) };
        case 'ArrowDown':
          return { col, row: Math.max(0, row - 1) };
        case 'Home':
          return { col: 0, row: 0 };
        case 'End':
          return { col: lastCol, row: 0 };
        default:
          return null;
      }
    })();

    if (!next) return;

    event.preventDefault();

    // A column with fewer slices than the row we came from: land on its
    // top slice rather than nowhere.
    const target = {
      col: next.col,
      row: Math.min(next.row, rowsIn(next.col) - 1),
    };
    const element = event.currentTarget.querySelector<HTMLElement>(
      `[${COL}="${target.col}"][${ROW}="${target.row}"]`,
    );

    setActive(target);
    element?.focus();
  };

  return (
    <ActiveMark.Provider value={{ active, setActive }}>
      <TooltipProvider delayDuration={100}>
        <div
          role="group"
          aria-label={label}
          className={className}
          style={style}
          onKeyDown={onKeyDown}
          data-test={dataTest}
        >
          {children}
        </div>
      </TooltipProvider>
    </ActiveMark.Provider>
  );
}

/**
 * One bar, slice or column. `detail` is both the tooltip and the accessible
 * name, so a screen reader hears exactly what a mouse user reads.
 */
export function ChartMark({
  col,
  row = 0,
  detail,
  className,
  style,
  children,
  ...data
}: {
  col: number;
  row?: number;
  detail: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
} & { [key: `data-${string}`]: string | number | boolean | undefined }) {
  const context = useContext(ActiveMark);
  const isActive = context?.active.col === col && context.active.row === row;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="img"
          aria-label={detail}
          tabIndex={isActive ? 0 : -1}
          onFocus={() => context?.setActive({ col, row })}
          className={cn(
            'outline-none focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-card',
            className,
          )}
          style={style}
          {...{ [COL]: col, [ROW]: row }}
          {...data}
        >
          {children}
        </div>
      </TooltipTrigger>
      <TooltipContent className={'tabular-nums'}>{detail}</TooltipContent>
    </Tooltip>
  );
}
