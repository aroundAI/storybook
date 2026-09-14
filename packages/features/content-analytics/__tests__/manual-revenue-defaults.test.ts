import { describe, expect, it } from 'vitest';

import { manualRevenueDefaults } from '../src/lib/manual-revenue';
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
