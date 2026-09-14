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
