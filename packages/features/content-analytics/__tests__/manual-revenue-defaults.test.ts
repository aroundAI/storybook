import { describe, expect, it } from 'vitest';

import {
  formatLocalDate,
  manualRevenueDefaults,
  parseAmountToCents,
  parseLocalDate,
} from '../src/lib/manual-revenue';
import { AddManualRevenueSchema } from '../src/lib/schemas/revenue.schema';

const ACCOUNT = '550e8400-e29b-41d4-a716-446655440000';
const PUBLISH = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/**
 * `zodResolver` validates the form's own values before `onSubmit` runs, so
 * anything the action needs and the defaults omit fails the whole submit.
 * Both previous versions of this form were unsubmittable for exactly that
 * reason — first `publishId: ''` against `.uuid().optional()`, then a
 * missing `accountId` against `.refine(publishId ?? accountId)` — and both
 * looked correct by inspection. Only putting the real defaults through the
 * real schema shows it.
 */
describe('manualRevenueDefaults', () => {
  const filled = (overrides: Record<string, unknown> = {}) => ({
    ...manualRevenueDefaults(ACCOUNT),
    date: '2026-09-14',
    revenueCents: 5000,
    ...overrides,
  });

  it('validates as channel-level revenue with no video chosen', () => {
    const result = AddManualRevenueSchema.safeParse(filled());

    expect(result.success).toBe(true);
  });

  it('validates when a video is chosen instead', () => {
    const result = AddManualRevenueSchema.safeParse(
      filled({ publishId: PUBLISH }),
    );

    expect(result.success).toBe(true);
  });

  it('carries an accountId, which the scope refinement requires', () => {
    // The refinement is `publishId ?? accountId`. Injecting accountId in
    // onSubmit satisfies the action and not the resolver, which never
    // calls onSubmit.
    expect(manualRevenueDefaults(ACCOUNT).accountId).toBe(ACCOUNT);
  });

  it('leaves publishId undefined rather than empty string', () => {
    // '' is not undefined — it is a string that fails uuid validation.
    expect(manualRevenueDefaults(ACCOUNT).publishId).toBeUndefined();
  });

  it('defaults the category to sponsorship, not licensing', () => {
    // Licensing is rarer; changing the default would silently
    // re-categorise whatever a user submits without touching the field.
    expect(manualRevenueDefaults(ACCOUNT).category).toBe('sponsorship');
  });

  it('still rejects a submission with neither scope', () => {
    const { accountId: _dropped, ...withoutAccount } = filled();
    const result = AddManualRevenueSchema.safeParse(withoutAccount);

    expect(result.success).toBe(false);
  });
});

describe('parseAmountToCents', () => {
  it('reads a plain amount', () => {
    expect(parseAmountToCents('250.00')).toBe(25_000);
    expect(parseAmountToCents('250')).toBe(25_000);
    expect(parseAmountToCents('0.01')).toBe(1);
  });

  it('allows a trailing dot mid-keystroke', () => {
    expect(parseAmountToCents('12.')).toBe(1_200);
  });

  it('refuses a thousands separator rather than reading its prefix', () => {
    // parseFloat('1,250.00') is 1. That passes .min(1), submits, reports
    // success, and overwrites a real figure with $1.00 while the field
    // still reads 1,250.00.
    expect(parseAmountToCents('1,250.00')).toBeNull();
    expect(parseAmountToCents('1 250')).toBeNull();
  });

  it('refuses currency symbols and stray text', () => {
    expect(parseAmountToCents('$250')).toBeNull();
    expect(parseAmountToCents('250usd')).toBeNull();
    expect(parseAmountToCents('abc')).toBeNull();
  });

  it('refuses a negative amount', () => {
    expect(parseAmountToCents('-250')).toBeNull();
  });

  it('reads a leading-decimal amount', () => {
    // `type="number"` accepted `.50`; requiring a leading digit turned a
    // common entry into a hard error whose message did not explain it.
    expect(parseAmountToCents('.50')).toBe(50);
    expect(parseAmountToCents('.5')).toBe(50);
  });

  it('still refuses a lone dot', () => {
    expect(parseAmountToCents('.')).toBeNull();
  });

  it('treats empty and whitespace as no amount', () => {
    expect(parseAmountToCents('')).toBeNull();
    expect(parseAmountToCents('   ')).toBeNull();
  });
});

describe('parseLocalDate / formatLocalDate', () => {
  it('reads a date as local, not UTC midnight', () => {
    // `new Date('2026-09-14')` is UTC midnight, which west of UTC is the
    // 13th — the trigger rendered the day before the one the user clicked.
    const date = parseLocalDate('2026-09-14')!;

    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(8);
    expect(date.getDate()).toBe(14);
  });

  it('round-trips through the string the column stores', () => {
    expect(formatLocalDate(parseLocalDate('2026-01-05')!)).toBe('2026-01-05');
    expect(formatLocalDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('has no date for a day that does not exist', () => {
    // `new Date(2026, 1, 31)` rolls over to 3 March rather than failing,
    // so the trigger would render a different day than the value submitted.
    expect(parseLocalDate('2026-02-31')).toBeNull();
    expect(parseLocalDate('2026-13-01')).toBeNull();
    expect(parseLocalDate('2026-04-31')).toBeNull();
  });

  it('accepts a real leap day', () => {
    expect(parseLocalDate('2028-02-29')?.getDate()).toBe(29);
  });

  it('has no date for an empty or partial value', () => {
    expect(parseLocalDate('')).toBeNull();
    expect(parseLocalDate(undefined)).toBeNull();
    expect(parseLocalDate('2026-09')).toBeNull();
    expect(parseLocalDate('not a date')).toBeNull();
  });
});
