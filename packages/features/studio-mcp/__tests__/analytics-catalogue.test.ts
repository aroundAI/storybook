import { describe, expect, it } from 'vitest';

import { defaultTools } from '../src/server/tools';
import {
  analyticsReadTools,
  analyticsTools,
  analyticsWriteTools,
} from '../src/server/tools/analytics';

/**
 * FILM-1906, the catalogue. The spec's table names one tool per dashboard
 * area and six writes; criterion 9 names what must never be exposed (ingest
 * and sync routes, report ingest, cron, manual revenue, platform revenue
 * sync, schedule changes, super-admin). The list is pinned exactly, so a
 * tool added by name has to be added here on purpose.
 */

const READ_TOOLS = [
  'get_account_overview',
  'get_project_analytics',
  'get_deep_dive',
  'get_retention_curve',
  'get_video_log',
  'get_language_analytics',
  'get_episode_analytics',
  'get_video_funnel',
  'get_revenue',
  'get_reach_overview',
  'list_experiments',
  'get_experiment',
  'list_channel_experiments',
  'get_channel_experiment',
  'get_tag_performance',
  'get_genome_findings',
  'get_data_coverage',
  'list_channels',
  'list_reports',
  'get_report_download',
  'get_analytics_settings',
  'get_saved_insights',
  'get_ai_usage',
  'get_performance_by_origin',
];

const WRITE_TOOLS = [
  'update_publish_note',
  'assign_publish_tags',
  'create_experiment',
  'start_experiment',
  'conclude_experiment',
  'abandon_experiment',
];

/** Criterion 9, as names: nothing in the catalogue may match one of these. */
const NEVER_EXPOSED =
  /sync|ingest|cron|manual|schedule|admin|generate|delete|purge|backfill|revenue_entry|webhook/;

const VIEWS: Record<string, readonly string[]> = {
  get_project_analytics: ['overview', 'content', 'daily', 'audience'],
  get_deep_dive: [
    'median',
    'rolling_views',
    'traffic',
    'back_catalog',
    'cohorts',
    'ypp_progress',
    'returning_viewers',
    'weekly_diagnostics',
    'subscribers',
  ],
  get_language_analytics: [
    'performance',
    'platform_matrix',
    'content_type',
    'shorts_source',
    'geography',
    'trend',
    'divergence',
  ],
  get_revenue: [
    'summary',
    'timeseries',
    'top_content',
    'projection',
    'by_currency',
  ],
  get_tag_performance: ['tags', 'median_by_tag', 'segments'],
};

describe('the analytics tool catalogue', () => {
  it('is exactly the spec table’s reads and the six writes', () => {
    expect(analyticsReadTools.map((tool) => tool.name)).toEqual(READ_TOOLS);
    expect(analyticsWriteTools.map((tool) => tool.name)).toEqual(WRITE_TOOLS);
    expect(analyticsTools).toHaveLength(READ_TOOLS.length + WRITE_TOOLS.length);
  });

  it('is spread into the default tool list once, beside whoami', () => {
    const names = defaultTools.map((tool) => tool.name);

    expect(names[0]).toBe('whoami');
    for (const name of [...READ_TOOLS, ...WRITE_TOOLS]) {
      expect(names.filter((candidate) => candidate === name)).toHaveLength(1);
    }
  });

  it('exposes nothing criterion 9 forbids', () => {
    expect(NEVER_EXPOSED.test('manual_sync')).toBe(true);
    expect(NEVER_EXPOSED.test('add_manual_revenue')).toBe(true);
    expect(NEVER_EXPOSED.test('create_scheduled_report')).toBe(true);

    const offenders = analyticsTools
      .map((tool) => tool.name)
      .filter((name) => NEVER_EXPOSED.test(name));

    expect(offenders).toEqual([]);
  });

  it('reads are studio:read and read-only; writes are studio:write and not', () => {
    for (const tool of analyticsReadTools) {
      expect(tool.scope, tool.name).toBe('studio:read');
      expect(tool.annotations.readOnlyHint, tool.name).toBe(true);
      expect(tool.annotations.destructiveHint, tool.name).toBe(false);
    }

    for (const tool of analyticsWriteTools) {
      expect(tool.scope, tool.name).toBe('studio:write');
      expect(tool.annotations.readOnlyHint, tool.name).toBe(false);
    }

    // Idempotent where a repeat changes nothing: replacing a tag set.
    expect(
      analyticsWriteTools.find((tool) => tool.name === 'assign_publish_tags')
        ?.annotations.idempotentHint,
    ).toBe(true);
    for (const name of [
      'start_experiment',
      'conclude_experiment',
      'abandon_experiment',
    ]) {
      expect(
        analyticsWriteTools.find((tool) => tool.name === name)?.annotations
          .idempotentHint,
        name,
      ).toBe(false);
    }
  });

  it('offers the view argument the spec table lists', () => {
    for (const [name, views] of Object.entries(VIEWS)) {
      const tool = analyticsTools.find((candidate) => candidate.name === name)!;
      const view = tool.inputSchema.view as { options?: string[] } | undefined;

      expect(view?.options, name).toEqual(views);
    }
  });

  it('lists page with cursor and a limit of at most 50', () => {
    for (const name of [
      'list_experiments',
      'list_channel_experiments',
      'list_reports',
      'get_video_log',
    ]) {
      const tool = analyticsTools.find((candidate) => candidate.name === name)!;

      expect(tool.inputSchema.cursor, name).toBeDefined();
      expect(() => tool.inputSchema.limit!.parse(51), name).toThrow();
      expect(tool.inputSchema.limit!.parse(50), name).toBe(50);
    }
  });

  it('never takes an account id: the connection’s team is the scope', () => {
    for (const tool of analyticsTools) {
      expect(Object.keys(tool.inputSchema), tool.name).not.toContain(
        'accountId',
      );
      expect(Object.keys(tool.inputSchema), tool.name).not.toContain('account');
    }
  });
});
