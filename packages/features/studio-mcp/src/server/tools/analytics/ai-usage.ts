import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

import { fetchAllRows } from '@kit/shared/pagination';

import { McpToolError } from '../../../errors';
import { defineTool } from '../../../registry';
import { READ_ONLY, dateRangeArgs, windowOf } from './shared';

/**
 * One `llm_usage_analytics` row as this tool reads it. `run_id` and the
 * run's mode exist once FILM-1903 lands (`llm_usage_analytics.run_id`
 * referencing `generation_runs`); before that the column is absent and the
 * select below is refused, which is detected rather than assumed.
 */
interface UsageRow {
  id: string;
  created_at: string;
  llm_provider: string;
  llm_model: string;
  template_slug: string;
  operation_name: string | null;
  status: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
  total_cost: number | null;
  run_id?: string | null;
  generation_runs?: { mode: string } | null;
}

interface UsageBucket {
  calls: number;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  /** Summed where any row measured it; null when none did, never 0. */
  totalCost: number | null;
}

const BASE_COLUMNS =
  'id, created_at, llm_provider, llm_model, template_slug, operation_name, status, prompt_tokens, completion_tokens, total_tokens, total_cost';

const BY_MODE_UNAVAILABLE =
  'Usage rows carry no run yet: FILM-1903 (#556) adds llm_usage_analytics.run_id, joined to generation_runs.mode. Until it lands the split by server/external mode cannot be read.';

/**
 * AI usage and cost for the team, from `llm_usage_analytics` under its
 * `has_account_access` policy (criterion 7). Split by run mode through
 * `generation_runs.mode` when the `run_id` column exists; `by_mode` is null
 * with the reason when it does not.
 */
export const getAiUsage = defineTool({
  name: 'get_ai_usage',
  title: 'AI usage and cost',
  description:
    'The team’s model usage in the window from llm_usage_analytics: calls, tokens and cost in total, by status, by provider and model, by prompt template, and by generation run mode (server: Gemini in the app; external: a client over MCP) where usage rows carry a run. Cost is null where no row measured it.',
  inputSchema: { ...dateRangeArgs },
  scope: 'studio:read',
  annotations: READ_ONLY,
  async handler(input, context) {
    const window = windowOf(input);
    // Untyped: the select names a column that may not exist yet (run_id),
    // which the typed parser would refuse at compile time.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = context.principal.supabase as unknown as SupabaseClient<any>;
    const accountId = context.accountId;
    const toExclusive = new Date(
      window.toDate.getTime() + 86_400_000,
    ).toISOString();

    const byMode = await detectRunColumn(client);
    const columns: string = byMode
      ? `${BASE_COLUMNS}, run_id, generation_runs(mode)`
      : BASE_COLUMNS;

    let rows: UsageRow[];

    try {
      rows = await fetchAllRows<UsageRow>(
        (from, to) =>
          client
            .from('llm_usage_analytics')
            .select(columns)
            .eq('account_id', accountId)
            .gte('created_at', window.fromDate.toISOString())
            .lt('created_at', toExclusive)
            .order('id')
            .range(from, to) as unknown as PromiseLike<{
            data: UsageRow[] | null;
            error: { message: string } | null;
          }>,
        'llm usage',
      );
    } catch {
      throw new McpToolError('INTERNAL', 'Could not read the usage rows.');
    }

    return {
      structuredContent: {
        window: { from: window.from, to: window.to },
        totals: fold(rows),
        byStatus: group(rows, (row) => row.status),
        byModel: group(rows, (row) => `${row.llm_provider}/${row.llm_model}`),
        byTemplate: group(rows, (row) => row.template_slug),
        byMode: byMode
          ? group(rows, (row) => row.generation_runs?.mode ?? 'unattributed')
          : null,
        notes: {
          byModeReason: byMode ? null : BY_MODE_UNAVAILABLE,
          unattributed:
            'A row with no run is counted under "unattributed": written before runs existed, or by a writer that logs none.',
        },
      },
    };
  },
});

/**
 * Whether `llm_usage_analytics.run_id` exists on this database. PostgREST
 * refuses a select naming an unknown column with 42703; anything else is
 * left to the read itself.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function detectRunColumn(client: SupabaseClient<any>): Promise<boolean> {
  const { error } = await client
    .from('llm_usage_analytics')
    .select('run_id')
    .limit(1);

  if (!error) return true;
  if (error.code === '42703' || /run_id/.test(error.message)) return false;

  throw new McpToolError('INTERNAL', 'Could not read the usage table.');
}

function fold(rows: UsageRow[]): UsageBucket {
  const sum = (pick: (row: UsageRow) => number | null) => {
    let total: number | null = null;

    for (const row of rows) {
      const value = pick(row);
      if (value !== null) total = (total ?? 0) + value;
    }

    return total;
  };

  return {
    calls: rows.length,
    promptTokens: sum((row) => row.prompt_tokens),
    completionTokens: sum((row) => row.completion_tokens),
    totalTokens: sum((row) => row.total_tokens),
    totalCost: sum((row) => row.total_cost),
  };
}

function group(rows: UsageRow[], key: (row: UsageRow) => string) {
  const buckets = new Map<string, UsageRow[]>();

  for (const row of rows) {
    const bucket = key(row);
    buckets.set(bucket, [...(buckets.get(bucket) ?? []), row]);
  }

  return Array.from(buckets, ([name, members]) => ({
    key: name,
    ...fold(members),
  })).sort((a, b) => b.calls - a.calls || a.key.localeCompare(b.key));
}
