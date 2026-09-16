import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ANALYTICS_DEFAULTS,
  parseOptionalInteger,
  resolveTagMinSample,
  resolveYppTarget,
} from '../src/lib/ypp-targets';

const CHANNEL = {
  ypp_target_watch_hours: null,
  ypp_target_subscribers: null,
  ypp_applicant_status: 'unknown' as const,
  joined_ypp_at: null,
};

const ACCOUNT = {
  ypp_target_watch_hours: null,
  ypp_target_subscribers: null,
};

describe('ANALYTICS_DEFAULTS', () => {
  it('are the numbers already shipped, so nothing moves on deploy', () => {
    // These were `?? 4000` and `?? 1000` in deep-dive-actions.ts and `?? 5`
    // in taxonomy-actions.ts. Moving them into one place must not be the
    // commit that also changes every account's goalposts.
    expect(ANALYTICS_DEFAULTS.watchHours).toBe(4000);
    expect(ANALYTICS_DEFAULTS.subscribers).toBe(1000);
    expect(ANALYTICS_DEFAULTS.tagMinSample).toBe(5);
  });

  it('hardcodes no escalation date anywhere in the module', () => {
    // An earlier draft escalated 4,000 watch hours to 8,000 on a date that
    // could not be verified against YouTube policy. A wrong date is the
    // worst available failure: on the day it fires every progress bar
    // silently halves against a bar that may not exist. The threshold is
    // configuration; this asserts the code did not quietly take it back.
    const source = readFileSync(
      join(__dirname, '../src/lib/ypp-targets.ts'),
      'utf8',
    );

    expect(source).not.toMatch(/\b20\d{2}-\d{2}-\d{2}\b/);
    expect(source).not.toMatch(/\b8000\b/);
    expect(source).not.toMatch(/new Date\(/);
  });
});

describe('resolveYppTarget', () => {
  it('falls through to the defaults when neither level is configured', () => {
    const result = resolveYppTarget({
      channelSettings: null,
      accountSettings: null,
    });

    expect(result.watchHours).toBe(4000);
    expect(result.subscribers).toBe(1000);
    expect(result.watchHoursBasis).toBe('default');
    expect(result.subscribersBasis).toBe('default');
  });

  it('uses the account row when there is no channel override', () => {
    const result = resolveYppTarget({
      channelSettings: null,
      accountSettings: { ...ACCOUNT, ypp_target_watch_hours: 3000 },
    });

    expect(result.watchHours).toBe(3000);
    expect(result.watchHoursBasis).toBe('account');
    // Untouched column still falls all the way through.
    expect(result.subscribers).toBe(1000);
    expect(result.subscribersBasis).toBe('default');
  });

  it('lets a channel override win over the account row', () => {
    const result = resolveYppTarget({
      // The status matters here and the first draft of this test missed it.
      // With the default `unknown`, a *downward* override collides with the
      // over-state rule below and resolves to 3000 — so a test of plain
      // precedence that left the status alone would have been asserting the
      // escalation rule while claiming to assert precedence.
      channelSettings: {
        ...CHANNEL,
        ypp_target_watch_hours: 2000,
        ypp_applicant_status: 'existing_partner',
      },
      accountSettings: { ...ACCOUNT, ypp_target_watch_hours: 3000 },
    });

    expect(result.watchHours).toBe(2000);
    expect(result.watchHoursBasis).toBe('channel');
  });

  it('lets a channel override win while the status is unknown, upward', () => {
    // Upward, precedence and the over-state rule agree, so this holds
    // whatever the status is.
    const result = resolveYppTarget({
      channelSettings: { ...CHANNEL, ypp_target_watch_hours: 9000 },
      accountSettings: { ...ACCOUNT, ypp_target_watch_hours: 3000 },
    });

    expect(result.watchHours).toBe(9000);
    expect(result.watchHoursBasis).toBe('channel');
  });

  it('does NOT let an unknown channel override the account downward', () => {
    // The spec's own acceptance criteria collide here: "a channel override
    // wins over the account row" and "with an escalated threshold
    // configured, `unknown` resolves to the higher bar" cannot both hold
    // when the override is lower and the status is the default `unknown`.
    //
    // The over-state rule wins, deliberately. Under-stating announces a gate
    // the channel has not cleared, which is the number someone acts on;
    // over-stating shows a channel short of one it may already have passed.
    // Setting the status to `existing_partner` is how an operator says the
    // lower bar is the real one.
    const result = resolveYppTarget({
      channelSettings: { ...CHANNEL, ypp_target_watch_hours: 2000 },
      accountSettings: { ...ACCOUNT, ypp_target_watch_hours: 3000 },
    });

    expect(result.watchHours).toBe(3000);
    expect(result.watchHoursBasis).toBe('account');
  });

  it('treats null on a channel column as inherit, never as zero', () => {
    // A nullable override column with a non-null default cannot express
    // "follow the account". If this ever returns 0 the progress bar reads
    // 100% complete against a bar of nothing.
    //
    // The status is pinned to a known one deliberately. Under the default
    // `unknown`, a null-read-as-0 bug resolves to {0, 3000} and the
    // over-state rule picks 3000 anyway — the right answer for the wrong
    // reason, and this test would sit green over the defect it names.
    const result = resolveYppTarget({
      channelSettings: {
        ...CHANNEL,
        ypp_target_watch_hours: null,
        ypp_target_subscribers: 2500,
        ypp_applicant_status: 'existing_partner',
      },
      accountSettings: { ...ACCOUNT, ypp_target_watch_hours: 3000 },
    });

    expect(result.watchHours).toBe(3000);
    expect(result.watchHoursBasis).toBe('account');
    expect(result.subscribers).toBe(2500);
    expect(result.subscribersBasis).toBe('channel');
  });

  it('reports each metric its own basis when they resolve at different levels', () => {
    // The two columns are independently nullable, so one `basis` for the
    // pair would be a lie in exactly this shape.
    const result = resolveYppTarget({
      channelSettings: { ...CHANNEL, ypp_target_subscribers: 500 },
      accountSettings: { ...ACCOUNT, ypp_target_watch_hours: 6000 },
    });

    expect(result.watchHoursBasis).toBe('account');
    expect(result.subscribersBasis).toBe('channel');
  });

  describe('applicant status', () => {
    it('takes the higher configured bar when the status is unknown', () => {
      // The locked decision: over-state the bar rather than under-state it.
      // Channel precedence alone would answer 4000 here.
      const result = resolveYppTarget({
        channelSettings: {
          ...CHANNEL,
          ypp_target_watch_hours: 4000,
          ypp_applicant_status: 'unknown',
        },
        accountSettings: { ...ACCOUNT, ypp_target_watch_hours: 8000 },
      });

      expect(result.watchHours).toBe(8000);
      expect(result.watchHoursBasis).toBe('account');
      expect(result.applicantStatus).toBe('unknown');
    });

    it('uses plain precedence once the status is known', () => {
      const result = resolveYppTarget({
        channelSettings: {
          ...CHANNEL,
          ypp_target_watch_hours: 4000,
          ypp_applicant_status: 'existing_partner',
        },
        accountSettings: { ...ACCOUNT, ypp_target_watch_hours: 8000 },
      });

      expect(result.watchHours).toBe(4000);
      expect(result.watchHoursBasis).toBe('channel');
    });

    it('is inert when only one level is configured', () => {
      // "Where no escalation is configured there is a single target and the
      // status is inert." An unconfigured level is not an escalation, so an
      // unknown status must not drag the answer up to the shipped default.
      const result = resolveYppTarget({
        channelSettings: {
          ...CHANNEL,
          ypp_target_watch_hours: 2000,
          ypp_applicant_status: 'unknown',
        },
        accountSettings: null,
      });

      expect(result.watchHours).toBe(2000);
      expect(result.watchHoursBasis).toBe('channel');
    });

    it('does not escalate when both levels agree', () => {
      const result = resolveYppTarget({
        channelSettings: {
          ...CHANNEL,
          ypp_target_watch_hours: 5000,
          ypp_applicant_status: 'unknown',
        },
        accountSettings: { ...ACCOUNT, ypp_target_watch_hours: 5000 },
      });

      expect(result.watchHours).toBe(5000);
      expect(result.watchHoursBasis).toBe('channel');
    });

    it('defaults to unknown when there is no channel row at all', () => {
      const result = resolveYppTarget({
        channelSettings: null,
        accountSettings: null,
      });

      expect(result.applicantStatus).toBe('unknown');
    });
  });

  describe('already joined', () => {
    it('reports a channel with joined_ypp_at as joined', () => {
      const result = resolveYppTarget({
        channelSettings: { ...CHANNEL, joined_ypp_at: '2026-03-01' },
        accountSettings: null,
      });

      expect(result.alreadyJoined).toBe(true);
      expect(result.joinedYppAt).toBe('2026-03-01');
    });

    it('is not joined when the date is absent', () => {
      const result = resolveYppTarget({
        channelSettings: CHANNEL,
        accountSettings: null,
      });

      expect(result.alreadyJoined).toBe(false);
      expect(result.joinedYppAt).toBeNull();
    });

    it('still resolves targets for a joined channel', () => {
      // The card stops rendering progress, but the numbers must stay
      // coherent — a joined channel that reports a target of 0 would divide
      // by zero the moment anything did render it.
      const result = resolveYppTarget({
        channelSettings: { ...CHANNEL, joined_ypp_at: '2026-03-01' },
        accountSettings: null,
      });

      expect(result.watchHours).toBe(4000);
      expect(result.subscribers).toBe(1000);
    });
  });
});

describe('resolveTagMinSample', () => {
  it('prefers the account value and falls back to the default', () => {
    expect(resolveTagMinSample({ tag_min_sample: 12 })).toBe(12);
    expect(resolveTagMinSample({ tag_min_sample: null })).toBe(5);
    expect(resolveTagMinSample(null)).toBe(5);
  });
});

describe('parseOptionalInteger', () => {
  it('reads an empty field as inherit, not as zero', () => {
    // The repo's existing numeric idiom is `parseInt(value, 10) || 5`,
    // which turns a cleared field into a *default* — the one answer that
    // makes "clear this override" impossible to express.
    expect(parseOptionalInteger('')).toBeNull();
    expect(parseOptionalInteger('   ')).toBeNull();
  });

  it('reads a whole number', () => {
    expect(parseOptionalInteger('4000')).toBe(4000);
    expect(parseOptionalInteger(' 250 ')).toBe(250);
  });

  it('rejects anything that is not a positive whole number', () => {
    // `undefined` means "do not write this", distinct from null's "write
    // SQL NULL". parseFloat-style prefix reading is what turned a pasted
    // `1,250.00` into 1 in FILM-1609, so a partial parse is a rejection.
    expect(parseOptionalInteger('1,250')).toBeUndefined();
    expect(parseOptionalInteger('12.5')).toBeUndefined();
    expect(parseOptionalInteger('abc')).toBeUndefined();
    expect(parseOptionalInteger('-1')).toBeUndefined();
    expect(parseOptionalInteger('0')).toBeUndefined();
  });
});
