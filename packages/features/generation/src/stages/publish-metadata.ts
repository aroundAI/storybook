/**
 * The `publish_metadata` stage (FILM-1901): titles and descriptions of the
 * items a publish draft will post, in each item's target language, in one
 * model pass. Target: the draft's items (the `batch-translate-metadata` job
 * payload). One part.
 *
 * Commit writes no row: the publish draft lives in the publish screen's
 * state and the result reaches it over the WebSocket, so there is nothing
 * in the database to store the translations on (audit 2026-10-03). It
 * returns every requested item, an untranslated one carrying its original
 * text, exactly as `handlers/batch-translate-metadata.ts` returned.
 */
import { z } from 'zod';

import batchTranslateMetadata from '@kit/prompt-engine/prompts/publishing/batch-translate-metadata.json';
import { sanitizeStrings } from '@kit/shared/prompt-sanitiser';

import { type PromptFile, buildBrief, singlePart } from '../brief';
import { registerStage } from '../registry';
import type { Brief, CheckError, StageDefinition } from '../types';

/** publishes.title is varchar(500) */
export const PUBLISH_TITLE_MAX = 500;

export const PublishMetadataItemSchema = z.object({
  id: z.string(),
  contentType: z.enum(['full-video', 'shorts-group']),
  title: z.string(),
  description: z.string(),
  targetLanguage: z.string(),
  groupId: z.string().optional(),
  groupName: z.string().optional(),
});
export type PublishMetadataItem = z.infer<typeof PublishMetadataItemSchema>;

/** The draft's items, as the `batch-translate-metadata` job carries them. */
export const PublishMetadataTargetSchema = z.object({
  items: z.array(PublishMetadataItemSchema).min(1),
});
export type PublishMetadataTarget = z.infer<typeof PublishMetadataTargetSchema>;

/** The `batch-translate-metadata` prompt's output. */
export const PublishMetadataOutputSchema = z.object({
  translations: z.array(
    z.object({
      id: z.string(),
      targetLanguage: z.string(),
      title: z.string().min(1).max(PUBLISH_TITLE_MAX),
      description: z.string(),
    }),
  ),
});
export type PublishMetadataOutput = z.infer<typeof PublishMetadataOutputSchema>;

export interface TranslatedPublishItem {
  id: string;
  translatedTitle: string;
  translatedDescription: string;
  targetLanguage: string;
  contentType: 'full-video' | 'shorts-group';
  groupId?: string;
}

export interface PublishMetadataCommitData {
  items: TranslatedPublishItem[];
}

function itemKey(item: { id: string; targetLanguage: string }) {
  return `${item.id}\u0000${item.targetLanguage}`;
}

/** Each requested item with its translation, or its own text when none. */
export function translatedItems(
  items: ReadonlyArray<PublishMetadataItem>,
  translations: ReadonlyArray<PublishMetadataOutput['translations'][number]>,
): TranslatedPublishItem[] {
  // Matched by id, like the handler; a reply naming the id twice keeps the
  // last, as a Map did there.
  const byId = new Map(translations.map((t) => [t.id, t]));

  return items.map((item) => {
    const translation = byId.get(item.id);

    return {
      id: item.id,
      translatedTitle: translation?.title || item.title,
      translatedDescription: translation?.description || item.description,
      targetLanguage: item.targetLanguage,
      contentType: item.contentType,
      groupId: item.groupId,
    };
  });
}

export const publishMetadataStage: StageDefinition<
  PublishMetadataTarget,
  PublishMetadataOutput,
  PublishMetadataCommitData
> = {
  key: 'publish_metadata',
  targetType: 'publish',
  targetSchema: PublishMetadataTargetSchema,
  outputSchema: PublishMetadataOutputSchema,

  async parts() {
    return [singlePart('metadata', 'Titles and descriptions per language')];
  },

  async prepare(_ctx, target, part): Promise<Brief> {
    const itemsForPrompt = target.items.map((item) => ({
      id: item.id,
      targetLanguage: item.targetLanguage,
      title: item.title,
      description: item.description,
    }));

    return buildBrief({
      stage: 'publish_metadata',
      part,
      prompt: batchTranslateMetadata as PromptFile,
      outputSchema: PublishMetadataOutputSchema,
      variables: {
        // Titles and descriptions to translate, defused (KB-101)
        items: JSON.stringify(sanitizeStrings(itemsForPrompt), null, 2),
        itemCount: target.items.length,
      },
      context: { items: target.items },
      constraints: {
        items: target.items.map((item) => ({
          id: item.id,
          targetLanguage: item.targetLanguage,
        })),
        titleMaxChars: PUBLISH_TITLE_MAX,
        oneTranslationPerItem: true,
      },
      targetVersion: null,
    });
  },

  async check(_ctx, target, out): Promise<CheckError[]> {
    const requested = new Set(target.items.map(itemKey));
    const seen = new Set<string>();
    const errors: CheckError[] = [];

    out.translations.forEach((translation, index) => {
      const key = itemKey(translation);
      const path = `translations.${index}`;

      if (!requested.has(key)) {
        errors.push({
          path,
          code: 'unknown_item',
          message: `No item ${translation.id} in ${translation.targetLanguage} was requested`,
        });
      } else if (seen.has(key)) {
        errors.push({
          path,
          code: 'duplicate_item',
          message: `Item ${translation.id} in ${translation.targetLanguage} is translated twice`,
        });
      }

      seen.add(key);
    });

    return errors;
  },

  async commit(_ctx, _run, target, outputs) {
    const items = translatedItems(
      target.items,
      outputs.flatMap((output) => output.translations),
    );

    return { status: 'committed', data: { items } };
  },
};

registerStage(publishMetadataStage);
