/**
 * A team's daily cap on LLM spend through the web app (owner decision
 * 2026-10-03, recorded under FILM-1910 and FILM-1902). `openRun` checks it
 * for a server-mode run before the run row exists. An external run (Claude
 * over MCP) makes no model call, and an ElevenLabs render is not LLM spend,
 * so neither ever reaches this.
 *
 * "Today" is the UTC day. Spend is the sum of priced llm_usage_analytics
 * rows of the team's server runs since UTC midnight; a row with no price
 * (Voyage embeddings, a failed call) is counted as unknown, never as 0,
 * and named in the refusal, but never refuses on its own.
 *
 * The check runs once, where work starts. A run opened under the cap
 * finishes, with the follow-ons its commit chains (shots -> audio cues),
 * so a day can end over the cap by what that work costs; runs opened
 * together (a bulk action) all see the spend from before any of them.
 */
import { GatewayError } from './errors';

export interface DailySpend {
  /** USD across priced calls; null when no call today has a price */
  spentUsd: number | null;
  pricedCalls: number;
  /** Calls whose cost is unknown: not counted, and not 0 */
  unpricedCalls: number;
}

export function utcDayStart(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function formatUsd(amount: number): string {
  return `$${amount.toFixed(amount !== 0 && Math.abs(amount) < 0.01 ? 4 : 2)}`;
}

function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Today's server-mode LLM spend for the team, or null when it cannot be
 * read. Read with the service-role client, the same one `recordUsage`
 * writes with, through `llm_spend_since` (one aggregate, so the 1000-row
 * cap never truncates it), which only the service role may execute. The
 * caller has already read the cap with its own client under RLS, so a user
 * who cannot see the team's settings never reaches this.
 */
export async function readDailyLlmSpend(
  accountId: string,
  since: Date,
): Promise<DailySpend | null> {
  try {
    const { createLambdaAdminClient } = await import(
      '@kit/supabase/lambda-admin-client'
    );
    const client = createLambdaAdminClient();

    if (!client) throw new Error('Service-role client unavailable');

    const { data, error } = await client.rpc('llm_spend_since', {
      p_account_id: accountId,
      p_since: since.toISOString(),
    });

    if (error) throw new Error(`${error.code}: ${error.message}`);

    const [row] = data ?? [];

    return {
      spentUsd: row?.spent_usd ?? null,
      pricedCalls: row?.priced_calls ?? 0,
      unpricedCalls: row?.unpriced_calls ?? 0,
    };
  } catch (error) {
    console.error(
      `[AI Gateway] Today's LLM spend for ${accountId} could not be read; daily spend cap not checked:`,
      error,
    );
    return null;
  }
}

export function dailySpendCapMessage(
  capUsd: number,
  spend: DailySpend,
  now: Date,
): string {
  const resetDay = new Date(utcDayStart(now).getTime() + 86_400_000)
    .toISOString()
    .slice(0, 10);
  const unknown =
    spend.unpricedCalls > 0
      ? `, not counting ${plural(spend.unpricedCalls, 'call whose cost is unknown', 'calls whose cost is unknown')}`
      : '';

  return `This team has reached its daily Gemini spend cap of ${formatUsd(capUsd)}: ${formatUsd(spend.spentUsd ?? 0)} spent today (UTC)${unknown}. The cap resets at 00:00 UTC (${resetDay}). Ask Claude to write it through the MCP connector, or raise the cap in Team settings under AI.`;
}

/**
 * Refuses a server run for a team whose priced spend today has reached its
 * cap. No cap, or spend that could not be read, opens the run: unmeasured
 * is not over.
 */
export async function assertUnderDailySpendCap(
  accountId: string,
  capUsd: number | null,
  now = new Date(),
): Promise<void> {
  if (capUsd === null) return;

  const spend = await readDailyLlmSpend(accountId, utcDayStart(now));

  if (!spend || (spend.spentUsd ?? 0) < capUsd) return;

  const message = dailySpendCapMessage(capUsd, spend, now);

  console.warn(
    `[AI Gateway] Daily spend cap reached for ${accountId}: cap ${capUsd}, spent ${spend.spentUsd} over ${spend.pricedCalls} priced calls, ${spend.unpricedCalls} unpriced`,
  );

  throw new GatewayError('DAILY_SPEND_CAP_REACHED', message);
}
