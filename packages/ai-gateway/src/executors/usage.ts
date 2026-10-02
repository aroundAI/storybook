/**
 * Every model call writes llm_usage_analytics with its run id (FILM-1902
 * criterion 7). The table accepts writes from the service role only
 * (KB-52), so the row goes through the Lambda-safe admin client, which reads
 * its env vars directly; a signed-in user's client would be refused and
 * logLLMUsage swallows that, so the row would vanish unnoticed. A failure
 * to log is reported, never a failed model call.
 */
import type { RunHandle } from '@kit/generation';
import { type LLMUsageEvent, logLLMUsage } from '@kit/llm';

export type UsageEventForRun = Omit<LLMUsageEvent, 'accountId' | 'runId'> & {
  accountId?: string;
};

export async function recordUsage(
  run: RunHandle,
  event: UsageEventForRun,
): Promise<void> {
  try {
    const { createLambdaAdminClient } = await import(
      '@kit/supabase/lambda-admin-client'
    );
    const client = createLambdaAdminClient();

    if (!client) {
      throw new Error('Service-role client unavailable: LLM usage not logged');
    }

    await logLLMUsage(client, {
      ...event,
      accountId: run.accountId,
      userId: event.userId ?? run.createdBy,
      runId: run.id,
    });
  } catch (error) {
    console.error('[AI Gateway] Failed to log LLM usage analytics:', error);
  }
}
