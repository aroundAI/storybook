/**
 * Defaults for the manual revenue entry form (FILM-1609).
 *
 * Here rather than inside the component so a test can put them through the
 * real schema. Two successive versions of this form were unsubmittable —
 * `publishId: ''` against `z.string().uuid().optional()`, then a missing
 * `accountId` against `.refine(publishId ?? accountId)` — and both looked
 * correct by inspection. `zodResolver` validates the form's own values
 * before `onSubmit` runs, so anything the schema needs and the defaults
 * omit kills the whole submit with an error on an unrelated field.
 */
import type { z } from 'zod';

import type { ManualRevenueCategorySchema } from './schemas/revenue.schema';

/** The categories a person may record by hand — the schema's subset. */
type ManualRevenueCategory = z.infer<typeof ManualRevenueCategorySchema>;

export interface ManualRevenueDefaults {
  publishId: undefined;
  accountId: string;
  date: string;
  revenueCents: number;
  currency: string;
  category: ManualRevenueCategory;
  notes: string;
}

export function manualRevenueDefaults(
  accountId: string,
): ManualRevenueDefaults {
  return {
    // `undefined`, never '': an empty string is not absent, it is a string
    // that fails uuid validation.
    publishId: undefined,
    // Present from the start, not injected at submit time: the scope
    // refinement is checked by the resolver, which runs first.
    accountId,
    date: '',
    revenueCents: 0,
    // Licensing is rarer than sponsorship, and changing a default silently
    // re-categorises whatever a user submits without touching the field.
    category: 'sponsorship',
    currency: 'USD',
    notes: '',
  };
}

/**
 * A whole-string amount: digits with an optional decimal part.
 *
 * The integer part is optional so `.50` is fifty cents — `type="number"`
 * accepted that, and requiring a leading digit made a common entry a hard
 * error with a message that did not explain it.
 */
const AMOUNT = /^(\d+(\.\d{0,2})?|\.\d{1,2})$/;

/**
 * Cents from what the user typed, or null when the text is not an amount.
 *
 * `parseFloat` is deliberately not used. It reads a numeric *prefix*, so
 * pasting `1,250.00` out of a spreadsheet yields `1` — which passes
 * validation, submits, reports success, and (because one entry per date
 * and category replaces the previous one) overwrites a real figure with
 * $1.00, while the field still reads `1,250.00`. The `type="number"`
 * widget used to reject that at the browser level; parsing the string
 * ourselves means rejecting it ourselves.
 *
 * A trailing dot is allowed so `12.` is 1200 rather than an error
 * mid-keystroke.
 */
export function parseAmountToCents(raw: string): number | null {
  const text = raw.trim();

  if (text === '') return null;

  // No trailing-dot strip: the pattern already admits `12.`, and stripping
  // first let a second dot through — `12..` normalised to `12.` and saved
  // $12.00 while the field displayed `12..`, which is the displayed-value-
  // is-not-saved-value bug this module exists to end, one keystroke away.
  if (!AMOUNT.test(text)) return null;

  return Math.round(Number.parseFloat(text) * 100);
}

/**
 * A `yyyy-MM-dd` string as a *local* date.
 *
 * `new Date('2026-09-14')` is parsed as UTC midnight, so west of UTC it is
 * the previous day: the trigger rendered "September 13th" the moment a
 * user clicked the 14th, while the calendar still highlighted the 14th and
 * the row saved as 2026-09-14 — three states, two of them disagreeing, on
 * the field that keys the replace-on-save behaviour.
 *
 * Returns null for anything that is not a full date, so a half-typed or
 * empty value renders as "Pick a date" rather than "Invalid Date".
 */
export function parseLocalDate(value: string | undefined): Date | null {
  if (!value) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) return null;

  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));

  // Round-tripped, because the constructor rolls over rather than failing:
  // `2026-02-31` becomes 3 March and `Number.isNaN` never fires, so the
  // trigger would show a different day than the value being submitted —
  // the three-disagreeing-states bug this function exists to end.
  return formatLocalDate(date) === value ? date : null;
}

/** A `Date` as the `yyyy-MM-dd` the schema and the column expect. */
export function formatLocalDate(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}
