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
import type { RevenueCategory } from './schemas/revenue.schema';

export interface ManualRevenueDefaults {
  publishId: undefined;
  accountId: string;
  date: string;
  revenueCents: number;
  currency: string;
  category: RevenueCategory;
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

/** A whole-string amount: digits, optionally one dot and up to two more. */
const AMOUNT = /^\d+(\.\d{0,2})?$/;

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

  const normalised = text.endsWith('.') ? text.slice(0, -1) : text;

  if (!AMOUNT.test(normalised)) return null;

  return Math.round(Number(normalised) * 100);
}
