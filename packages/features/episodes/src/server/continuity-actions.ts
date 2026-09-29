'use server';

import { revalidatePath } from 'next/cache';

import { createAuditLog, extractNetworkContext } from '@kit/audit-logs/server';
import { createLLMClient } from '@kit/llm';
import { ActionRefusal } from '@kit/next/action-result';
import { enhanceAction } from '@kit/next/actions';
import {
  requireAffectedRows,
  requireRow,
  returnRefusals,
} from '@kit/next/refusals';
import { getLogger } from '@kit/shared/logger';
import { whyNoRow } from '@kit/shared/rows';
import { requireUser } from '@kit/supabase/require-user';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

import {
  CheckContinuitySchema,
  FixContinuityIssueSchema,
} from '../lib/continuity-schemas';
import type {
  ContinuityCheckResult,
  ContinuityIssue,
} from '../lib/continuity-types';

/**
 * System prompt for continuity analysis
 */
const CONTINUITY_CHECK_SYSTEM_PROMPT = `You are a professional script supervisor checking for continuity errors.
Analyze the provided story, screenplay, and shot list for inconsistencies.

Check for:
1. Character Location - Characters appearing in wrong places
2. Character Knowledge - Characters knowing things they shouldn't
3. Timeline Inconsistency - Events out of chronological order
4. Prop Continuity - Props appearing/disappearing incorrectly
5. Setting Change - Location details changing unexpectedly
6. Dialogue Reference - References to non-existent events
7. Visual Continuity - Visual description mismatches
8. Costume Change - Unexplained costume changes
9. Time of Day - Lighting/time inconsistencies

Return a JSON array of issues with this structure:
[{
  "id": "unique-id",
  "type": "character_location|character_knowledge|timeline_inconsistency|prop_continuity|setting_change|dialogue_reference|visual_continuity|costume_change|time_of_day",
  "severity": "error|warning|suggestion",
  "title": "Brief title",
  "description": "Detailed explanation",
  "locations": [{"type": "story|screenplay|shot", "sceneNumber": 1, "excerpt": "relevant text"}],
  "suggestion": "How to fix it",
  "autoFixable": true|false
}]

IMPORTANT: Only return genuine issues. Avoid false positives.
If no issues are found, return an empty array: []
Return ONLY valid JSON, no markdown or extra text.`;

/**
 * System prompt for fixing continuity issues
 */
const CONTINUITY_FIX_SYSTEM_PROMPT = `You are a professional script editor. Fix the continuity issue described.
Return the corrected content in the same JSON format as the input.

Return a JSON object with the fixed content:
{
  "story": { ... corrected story data if changed ... },
  "screenplay": { ... corrected screenplay data if changed ... }
}

Only include the fields that need to be changed.
Return ONLY valid JSON, no markdown or extra text.`;

/**
 * Check episode content for continuity issues
 */
export const checkContinuityAction = enhanceAction(
  async (data): Promise<{ success: true; data: ContinuityCheckResult }> => {
    const logger = await getLogger();
    const ctx = { name: 'continuity.check', episodeId: data.episodeId };

    logger.info(ctx, 'Starting continuity check');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      logger.warn(ctx, 'Unauthorized continuity check attempt');
      throw new Error('Authentication required');
    }

    // Fetch episode with all content
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: episode, error: episodeError } = await (client as any)
      .from('episodes')
      .select(
        `
        id,
        story_data,
        screenplay_data,
        shot_list,
        project:projects(id, account_id)
      `,
      )
      .eq('id', data.episodeId)
      .is('deleted_at', null)
      .single();

    if (episodeError || !episode) {
      logger.error({ ...ctx, error: episodeError }, 'Episode not found');
      throw new Error(whyNoRow(episodeError, 'Episode not found'));
    }

    // Check if there's content to analyze
    if (!episode.story_data && !episode.screenplay_data && !episode.shot_list) {
      logger.info(ctx, 'No content to check for continuity');
      return {
        success: true,
        data: {
          issues: [],
          checkedAt: new Date().toISOString(),
          episodeId: data.episodeId,
        },
      };
    }

    // Prepare context for LLM
    const context = {
      story: episode.story_data ?? null,
      screenplay: episode.screenplay_data ?? null,
      shots: episode.shot_list ?? null,
      characters: extractCharacters(episode),
      locations: extractLocations(episode),
    };

    // Use LLM to analyze continuity
    const llmClient = createLLMClient();
    const response = await llmClient.createChatCompletion({
      messages: [
        {
          role: 'system',
          content: CONTINUITY_CHECK_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: JSON.stringify(context, null, 2),
        },
      ],
      temperature: 0.3,
      maxTokens: 4000,
    });

    let issues: ContinuityIssue[] = [];

    try {
      const content = response.message.content;
      issues = JSON.parse(content) as ContinuityIssue[];

      // Validate and ensure all issues have required fields
      issues = issues.map((issue, index) => ({
        id: issue.id ?? `issue-${index + 1}`,
        type: issue.type,
        severity: issue.severity,
        title: issue.title,
        description: issue.description,
        locations: issue.locations ?? [],
        suggestion: issue.suggestion,
        autoFixable: issue.autoFixable ?? false,
      }));
    } catch (parseError) {
      logger.error({ ...ctx, parseError }, 'Failed to parse LLM response');
      throw new Error('Failed to analyze content for continuity issues');
    }

    logger.info(
      { ...ctx, issueCount: issues.length },
      'Continuity check completed',
    );

    return {
      success: true,
      data: {
        issues,
        checkedAt: new Date().toISOString(),
        episodeId: data.episodeId,
      },
    };
  },
  {
    schema: CheckContinuitySchema,
  },
);

/**
 * Auto-fix a specific continuity issue
 */
const fixContinuityIssue = enhanceAction(
  async (data): Promise<{ success: true; data: { fixedIssueId: string } }> => {
    const logger = await getLogger();
    const ctx = {
      name: 'continuity.fix',
      episodeId: data.episodeId,
      issueId: data.issueId,
    };

    logger.info(ctx, 'Attempting to fix continuity issue');

    const client = getSupabaseServerClient();
    const { data: user, error: authError } = await requireUser(client);

    if (authError || !user) {
      throw new Error('Authentication required');
    }

    // First, re-run the check to get current issues
    const checkResult = await checkContinuityAction({
      episodeId: data.episodeId,
    });
    const issue = checkResult.data.issues.find((i) => i.id === data.issueId);

    if (!issue) {
      throw new ActionRefusal('Issue not found - it may have been resolved');
    }

    if (!issue.autoFixable) {
      throw new ActionRefusal('This issue cannot be auto-fixed');
    }

    // Fetch episode for fixing (include project for audit log)
    const episode = requireRow(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (client as any)
        .from('episodes')
        .select(
          `
        id, project_id, title, story_data, screenplay_data, shot_list,
        created_at, updated_at, deleted_at,
        project:projects(id, account_id)
      `,
        )
        .eq('id', data.episodeId)
        .is('deleted_at', null)
        .single(),
      'Episode not found',
    );

    // Use LLM to generate the fix
    const llmClient = createLLMClient();
    const response = await llmClient.createChatCompletion({
      messages: [
        {
          role: 'system',
          content: CONTINUITY_FIX_SYSTEM_PROMPT,
        },
        {
          role: 'user',
          content: JSON.stringify(
            {
              issue,
              currentContent: {
                story: episode.story_data,
                screenplay: episode.screenplay_data,
              },
            },
            null,
            2,
          ),
        },
      ],
      temperature: 0.2,
      maxTokens: 4000,
    });

    let fix: { story?: unknown; screenplay?: unknown };

    try {
      fix = JSON.parse(response.message.content);
    } catch (parseError) {
      logger.error({ ...ctx, parseError }, 'Failed to parse fix response');
      throw new Error('Failed to generate fix');
    }

    // Apply fix
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (fix.story) {
      updates.story_data = fix.story;
    }

    if (fix.screenplay) {
      updates.screenplay_data = fix.screenplay;
    }

    if (Object.keys(updates).length > 1) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: updated, error: updateError } = await (client as any)
        .from('episodes')
        .update(updates)
        .eq('id', data.episodeId)
        .select('id');

      if (updateError) {
        logger.error({ ...ctx, error: updateError }, 'Failed to apply fix');
        throw new Error('Failed to apply fix');
      }

      requireAffectedRows(updated, "You can't change this episode.");

      // Create audit log
      const accountId = episode.project?.account_id;
      if (accountId) {
        const networkContext = await extractNetworkContext();

        await createAuditLog({
          accountId,
          userId: user.id,
          action: 'update',
          objectType: 'episode',
          objectId: data.episodeId,
          objectName: episode.title,
          before: {
            story_data: episode.story_data,
            screenplay_data: episode.screenplay_data,
          },
          after: {
            story_data: fix.story ?? episode.story_data,
            screenplay_data: fix.screenplay ?? episode.screenplay_data,
          },
          scopes: [
            { type: 'account', id: accountId },
            { type: 'project', id: episode.project_id },
            { type: 'episode', id: data.episodeId },
          ],
          metadata: {
            fixType: 'continuity',
            issueId: data.issueId,
            issueType: issue.type,
          },
          ...networkContext,
        });
      }

      // Revalidate cache
      revalidatePath('/home/[account]/projects/[id]', 'page');
    }

    logger.info(ctx, 'Continuity issue fixed');

    return {
      success: true,
      data: { fixedIssueId: data.issueId },
    };
  },
  {
    schema: FixContinuityIssueSchema,
  },
);

export const fixContinuityIssueAction = returnRefusals(fixContinuityIssue);

// Helper functions

function extractCharacters(episode: {
  story_data?: unknown;
  screenplay_data?: unknown;
}): string[] {
  const characters = new Set<string>();

  // Extract from screenplay dialogue
  if (episode.screenplay_data && typeof episode.screenplay_data === 'object') {
    const screenplayData = episode.screenplay_data as Record<string, unknown>;
    if (Array.isArray(screenplayData.dialogue)) {
      screenplayData.dialogue.forEach((line) => {
        if (
          typeof line === 'object' &&
          line !== null &&
          'characterName' in line
        ) {
          characters.add(String(line.characterName));
        }
      });
    }
  }

  return Array.from(characters);
}

function extractLocations(episode: { screenplay_data?: unknown }): string[] {
  const locations = new Set<string>();

  if (episode.screenplay_data && typeof episode.screenplay_data === 'object') {
    const screenplayData = episode.screenplay_data as Record<string, unknown>;
    if (Array.isArray(screenplayData.scenes)) {
      screenplayData.scenes.forEach((scene) => {
        if (
          typeof scene === 'object' &&
          scene !== null &&
          'location' in scene
        ) {
          locations.add(String(scene.location));
        }
      });
    }
  }

  return Array.from(locations);
}
