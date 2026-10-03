/**
 * The `episode_summary` stage (FILM-1901, part D): one part over an
 * episode's story text, producing the SCORE fields (summary, sentiment, key
 * events) and the canon changes for review.
 *
 * This is `extractCanonChangesAction` behind a stage. That action writes
 * nothing: it returns the extraction, the user reviews it in the publish
 * step, and `commitCanonChangesAction` (the commit_canon_changes RPC) writes
 * the canon tables on "Save to Canon". So commit() here maps the validated
 * extraction to that review payload and persists nothing; the write stays
 * behind the user's approval. An external run's finalize goes through the
 * same approval (FILM-1909).
 */
import { z } from 'zod';

import canonExtractionPrompt from '@kit/prompt-engine/prompts/canon-roles/canon-extraction.json';
import {
  type CanonExtraction,
  type CanonExtractionOutput,
  CanonExtractionOutputSchema,
  ImmutableEventTypeSchema,
} from '@kit/prompt-engine/schemas';

import { type PromptFile, buildBrief, singlePart } from '../brief';
import { describeStateChange } from '../canon/memory-rows';
import { registerStage } from '../registry';
import type { CheckError, StageDefinition } from '../types';

export const EpisodeSummaryTargetSchema = z.object({
  projectId: z.string().uuid(),
  episodeId: z.string().uuid(),
  storyContent: z.string(),
});

export type EpisodeSummaryTarget = z.infer<typeof EpisodeSummaryTargetSchema>;

/** The extraction as the publish step reviews it (CanonExtractionResult). */
export interface EpisodeSummaryResult {
  immutableEvents: Array<{
    type: z.infer<typeof ImmutableEventTypeSchema>;
    eventKey: string;
    description: string;
    confidence: 'high' | 'medium' | 'low';
  }>;
  threadUpdates: CanonExtraction['threadUpdates'];
  stateChanges: CanonExtraction['characterStateChanges'];
  episodeSummary: string;
  sentimentScore: number;
  keyEvents: string[];
  characterChanges: string[];
  worldState?: {
    location: string;
    timePeriod?: string;
    atmosphere?: string;
    activeConflicts?: string[];
  };
}

/** The story text, with the most common override phrasings removed. */
export const STORY_CONTENT_MAX_CHARS = 50_000;

export function sanitizeStoryContent(storyContent: string): string {
  return storyContent
    .replace(/\b(system|assistant)\s*:\s*/gi, '')
    .replace(
      /\bignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)\b/gi,
      '',
    )
    .replace(/\byou\s+are\s+now\b/gi, '')
    .replace(
      /\bforget\s+(all\s+)?(previous|your)\s+(instructions?|rules?|context)\b/gi,
      '',
    )
    .substring(0, STORY_CONTENT_MAX_CHARS)
    .trim();
}

export function toEpisodeSummaryResult(
  extraction: CanonExtraction,
): EpisodeSummaryResult {
  return {
    immutableEvents: extraction.immutableEvents.map((event) => ({
      type: event.type,
      eventKey: event.eventKey,
      description: event.description,
      confidence: event.confidence,
    })),
    threadUpdates: extraction.threadUpdates.map((thread) => ({
      threadName: thread.threadName,
      threadType: thread.threadType,
      action: thread.action,
      description: thread.description,
      promises: thread.promises,
    })),
    stateChanges: extraction.characterStateChanges.map((change) => ({
      characterName: change.characterName,
      stateType: change.stateType,
      fromState: change.fromState,
      toState: change.toState,
      triggerEvent: change.triggerEvent,
    })),
    episodeSummary: extraction.episodeSummary,
    sentimentScore: Math.max(0, Math.min(1, extraction.sentimentScore)),
    keyEvents: extraction.keyEvents,
    characterChanges: extraction.characterStateChanges.map(describeStateChange),
    worldState: extraction.worldState?.location
      ? {
          location: extraction.worldState.location,
          timePeriod: extraction.worldState.timePeriod,
          atmosphere: extraction.worldState.atmosphere,
          activeConflicts: extraction.worldState.activeConflicts,
        }
      : undefined,
  };
}

export const episodeSummaryStage: StageDefinition<
  EpisodeSummaryTarget,
  CanonExtractionOutput,
  EpisodeSummaryResult
> = {
  key: 'episode_summary',
  targetType: 'episode',
  targetSchema: EpisodeSummaryTargetSchema,
  outputSchema: CanonExtractionOutputSchema,

  async parts() {
    return [singlePart('extraction', 'Summary, sentiment and canon changes')];
  },

  async prepare(ctx, target, part) {
    const { data: activeThreads } = await ctx.client
      .from('narrative_threads')
      .select('thread_name, thread_type, status, description, promises')
      .eq('project_id', target.projectId)
      .in('status', ['open', 'progressed']);

    const threads = activeThreads ?? [];
    const threadsContext = threads.length
      ? threads
          .map(
            (t) =>
              `- "${t.thread_name}" (${t.thread_type ?? 'plot'}, ${t.status ?? 'open'}): ${t.description ?? ''}. Promises: ${(t.promises ?? []).join(', ') || 'none'}`,
          )
          .join('\n')
      : 'No active threads';

    const { data: projectCharacters } = await ctx.client
      .from('assets')
      .select('name, type')
      .eq('project_id', target.projectId)
      .eq('type', 'character')
      .limit(30);

    const characters = projectCharacters ?? [];
    const charsContext = characters.length
      ? characters.map((c) => `- ${c.name}`).join('\n')
      : 'No characters defined';

    return buildBrief({
      stage: 'episode_summary',
      part,
      prompt: canonExtractionPrompt as PromptFile,
      variables: {
        story_content: sanitizeStoryContent(target.storyContent),
        existing_characters: charsContext,
        existing_threads: threadsContext,
      },
      context: {
        episode: { id: target.episodeId },
        project: { id: target.projectId },
        characters: characters.map((c) => c.name),
        activeThreads: threads,
      },
      outputSchema: CanonExtractionOutputSchema,
      constraints: {
        sentimentScore: 'from 0 (darkest) to 1 (most positive)',
        keyEvents: '3 to 5 brief phrases',
        immutableEventTypes: ImmutableEventTypeSchema.options,
        episodeSummary: '2 to 3 sentences',
      },
      targetVersion: null,
    });
  },

  async check(_ctx, _target, out) {
    const errors: CheckError[] = [];
    const { extraction } = out;

    extraction.immutableEvents.forEach((event, index) => {
      if (!event.eventKey.trim()) {
        errors.push({
          path: `extraction.immutableEvents.${index}.eventKey`,
          code: 'empty_event_key',
          message: 'An immutable event needs a key',
        });
      }
    });

    extraction.threadUpdates.forEach((thread, index) => {
      if (!thread.threadName.trim()) {
        errors.push({
          path: `extraction.threadUpdates.${index}.threadName`,
          code: 'empty_thread_name',
          message: 'A thread update needs the thread’s name',
        });
      }
    });

    extraction.characterStateChanges.forEach((change, index) => {
      if (!change.characterName.trim()) {
        errors.push({
          path: `extraction.characterStateChanges.${index}.characterName`,
          code: 'empty_character_name',
          message: 'A state change needs the character’s name',
        });
      }
    });

    return errors;
  },

  async commit(_ctx, _run, _target, outputs) {
    const [output] = outputs;

    if (!output) {
      throw new Error('The episode_summary stage received no extraction');
    }

    return {
      status: 'skipped',
      reason:
        'review pending: commitCanonChangesAction writes the canon tables once the user approves',
      data: toEpisodeSummaryResult(output.extraction),
    };
  },
};

registerStage(episodeSummaryStage);
