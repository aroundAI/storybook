import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { evaluateRevenueAlerts } from '../src/server/revenue-alerts';

/**
 * Revenue alerts are evaluated per currency (KB-12).
 *
 * Both rules compare amounts — today against a trailing average, a month's
 * total against a milestone — and both used to add every row's cents
 * whatever currency it was in. A euro sponsorship then tripped a dollar
 * spike, a steady euro income hid a real dollar one, and "Passed $100" was
 * announced for $95 and €20.
 */
interface SeedRow {
  record_date: string;
  currency: string | null;
  cents: number;
}

let rows: SeedRow[] = [];

vi.mock('../src/server/revenue-queries', () => ({
  forEachAccountRevenueRow: vi.fn(
    async (
      _client: unknown,
      _accountId: string,
      _from: string,
      _to: string,
      onRow: (row: unknown) => void,
    ) => {
      for (const row of rows) {
        onRow({
          record_date: row.record_date,
          amount: { currency: row.currency, cents: row.cents },
        });
      }
    },
  ),
}));

vi.mock('@kit/shared/logger', () => ({
  getLogger: async () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

interface InsertedAlert {
  alert_type: string;
  title: string;
  message: string;
  related_data: Record<string, unknown>;
}

function createClient() {
  const inserted: InsertedAlert[] = [];

  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({ gte: async () => ({ data: [], error: null }) }),
      }),
      insert: async (alerts: InsertedAlert[]) => {
        inserted.push(...alerts);

        return { error: null };
      },
    }),
  };

  return { client: client as never, inserted };
}

const TODAY = '2026-09-20';

/** `count` consecutive days ending yesterday, each with the same amount. */
function priorDays(count: number, currency: string, cents: number): SeedRow[] {
  return Array.from({ length: count }, (_, index) => {
    const day = new Date(`${TODAY}T00:00:00Z`);

    day.setUTCDate(day.getUTCDate() - (index + 1));

    return { record_date: day.toISOString().slice(0, 10), currency, cents };
  });
}

describe('evaluateRevenueAlerts', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`));
  });

  afterEach(() => {
    vi.useRealTimers();
    rows = [];
  });

  it('does not let a euro sponsorship trip a dollar spike', async () => {
    // $10 a day, $12 today: no spike. €500 arriving today is not 51× the
    // dollar average — it is the first euro this account has recorded.
    rows = [
      ...priorDays(9, 'USD', 1000),
      { record_date: TODAY, currency: 'USD', cents: 1200 },
      { record_date: TODAY, currency: 'EUR', cents: 50_000 },
    ];

    const { client, inserted } = createClient();

    await evaluateRevenueAlerts(client, 'account-1');

    expect(
      inserted.filter((alert) => alert.alert_type === 'significant_change'),
    ).toEqual([]);
  });

  it('does not let steady euro income mask a dollar spike', async () => {
    // Dollars went from $10 a day to $50: 5×. Beside €1,000 a day the
    // summed figure moved 4%, and the spike was never reported.
    rows = [
      ...priorDays(10, 'USD', 1000),
      ...priorDays(10, 'EUR', 100_000),
      { record_date: TODAY, currency: 'USD', cents: 5000 },
      { record_date: TODAY, currency: 'EUR', cents: 100_000 },
    ];

    const { client, inserted } = createClient();

    await evaluateRevenueAlerts(client, 'account-1');

    const spikes = inserted.filter(
      (alert) => alert.alert_type === 'significant_change',
    );

    expect(spikes).toHaveLength(1);
    // Named, because two currencies can spike on one day and the 24-hour
    // dedupe keys on the title.
    expect(spikes[0]?.title).toBe('Revenue spike today (USD)');
    expect(spikes[0]?.message).toBe(
      "Today's revenue is 5.0x the 28-day average.",
    );
    expect(spikes[0]?.related_data).toMatchObject({
      currency: 'USD',
      todayCents: 5000,
      trailingAverageCents: 1000,
    });
  });

  it('counts a milestone within one currency, never across two', async () => {
    // $95 and €20 this month. Added together that is "11500", which passed
    // the 10000 milestone today — in no currency anyone was paid in.
    rows = [
      ...priorDays(9, 'USD', 1000),
      { record_date: TODAY, currency: 'USD', cents: 500 },
      { record_date: TODAY, currency: 'EUR', cents: 2000 },
    ];

    const { client, inserted } = createClient();

    await evaluateRevenueAlerts(client, 'account-1');

    expect(
      inserted.filter((alert) => alert.alert_type === 'threshold_reached'),
    ).toEqual([]);
  });

  it('names the milestone in the currency that reached it', async () => {
    rows = [
      ...priorDays(9, 'USD', 1000),
      { record_date: TODAY, currency: 'EUR', cents: 12_000 },
    ];

    const { client, inserted } = createClient();

    await evaluateRevenueAlerts(client, 'account-1');

    const milestones = inserted.filter(
      (alert) => alert.alert_type === 'threshold_reached',
    );

    expect(milestones.map((alert) => alert.title)).toEqual([
      'Passed €100 this month',
    ]);
    expect(milestones[0]?.message).toBe('Month-to-date revenue reached €120.');
  });

  it('says what it always said to an account with one currency', async () => {
    rows = [
      ...priorDays(9, 'USD', 1000),
      { record_date: TODAY, currency: 'USD', cents: 4000 },
    ];

    const { client, inserted } = createClient();

    await evaluateRevenueAlerts(client, 'account-1');

    expect(
      inserted.map(({ alert_type, title, message }) => ({
        alert_type,
        title,
        message,
      })),
    ).toEqual([
      {
        alert_type: 'significant_change',
        title: 'Revenue spike today',
        message: "Today's revenue is 4.0x the 28-day average.",
      },
      {
        alert_type: 'threshold_reached',
        title: 'Passed $100 this month',
        message: 'Month-to-date revenue reached $130.',
      },
    ]);
  });
});
