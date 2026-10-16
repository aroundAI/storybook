/**
 * Comment Labels Handler (FILM-1733)
 *
 * Labels a project's unlabelled audience comments with a tone and the
 * topics they are about, from closed lists, and writes them to
 * comment_labels as the server's (source 'server'). Opened hourly by the
 * comment sync for each project with unlabelled comments, when the team
 * lets the server generate; a team that does not labels them with its own
 * AI through the MCP connector instead.
 *
 * Comment text is strangers' text: it reaches the model defused (KB-101),
 * and only labels from the closed lists, for ids in the batch, are written.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import { z } from 'zod';

import {
  COMMENT_LABEL_PROMPT_VERSION,
  CommentLabelSchema,
  commentLabelInstructions,
} from '@kit/content-analytics/lib/audience-comments/labels';
import { sanitizeStrings } from '@kit/episodes/lib';
import { parseLlmJobPayload } from '@kit/prompt-engine/llm-job-payloads';
import { fetchAllRows } from '@kit/shared/pagination';
import type { Database } from '@kit/supabase/database';

/** Comments per model call */
export const LABEL_BATCH = 50;

/** Model calls per run; what is left waits for the next hour */
export const MAX_BATCHES_PER_RUN = 4;

const ReplySchema = z.object({ labels: z.array(z.unknown()) });

export interface CommentLabelsResult {
  success: boolean;
  data: { labelled: number; skipped: number; batches: number };
}

export async function processCommentLabels(
  payload: Record<string, unknown>,
  supabase: SupabaseClient<Database>,
): Promise<CommentLabelsResult> {
  const data = parseLlmJobPayload('comment-labels', payload);

  const publishes = await fetchAllRows<{ id: string }>(
    (from, to) =>
      supabase
        .from('publishes')
        .select('id, episodes!inner(project_id)')
        .eq('episodes.project_id', data.projectId)
        .order('id')
        .range(from, to),
    'project publishes',
  );

  const publishIds = publishes.map((p) => p.id);
  const sent = new Set<string>();
  const labelledIds = new Set<string>();
  let batches = 0;

  if (publishIds.length === 0) {
    return { success: true, data: { labelled: 0, skipped: 0, batches } };
  }

  const { executeLLM } = await import('@kit/ai-gateway');

  while (batches < MAX_BATCHES_PER_RUN) {
    const { data: comments, error } = await supabase.rpc(
      'unlabelled_audience_comments',
      {
        p_account_id: data.accountId,
        p_publish_ids: publishIds,
        p_limit: LABEL_BATCH,
      },
    );

    if (error) {
      throw new Error(`Could not read unlabelled comments: ${error.message}`);
    }

    if (!comments?.length) break;

    const result = await executeLLM<unknown>({
      templateSlug: 'comment-labels',
      variables: {
        instructions: commentLabelInstructions(),
        comments: JSON.stringify(
          sanitizeStrings(comments.map(({ id, text }) => ({ id, text }))),
          null,
          2,
        ),
      },
      context: {
        name: 'label-audience-comments',
        accountId: data.accountId,
        userId: data.userId,
      },
    });
    batches++;

    const inBatch = new Set(comments.map((c) => c.id));
    for (const commentId of inBatch) sent.add(commentId);
    const reply = ReplySchema.safeParse(result.data);
    const rows = (reply.success ? reply.data.labels : []).flatMap((raw) => {
      const label = CommentLabelSchema.safeParse(raw);

      return label.success && inBatch.has(label.data.commentId)
        ? [
            {
              comment_id: label.data.commentId,
              account_id: data.accountId,
              sentiment: label.data.sentiment,
              topics: label.data.topics,
              source: 'server' as const,
              model: result.metadata.model,
              prompt_version: COMMENT_LABEL_PROMPT_VERSION,
              labelled_at: new Date().toISOString(),
            },
          ]
        : [];
    });

    // One label per comment, the first the model gave
    const unique = rows.filter(
      (row, index) =>
        rows.findIndex((other) => other.comment_id === row.comment_id) ===
        index,
    );

    if (unique.length) {
      const { error: writeError } = await supabase
        .from('comment_labels')
        .upsert(unique, { onConflict: 'comment_id' });

      if (writeError) {
        throw new Error(`Could not write labels: ${writeError.message}`);
      }
    }

    for (const row of unique) labelledIds.add(row.comment_id);

    // The model labelled none of a batch: asking again would loop
    if (unique.length === 0) break;
  }

  // Sent but never labelled: they wait for the next run
  const labelled = labelledIds.size;
  const skipped = sent.size - labelled;

  console.log(
    `[Comment Labels] project ${data.projectId}: ${labelled} labelled, ${skipped} skipped, ${batches} calls`,
  );

  return { success: true, data: { labelled, skipped, batches } };
}
