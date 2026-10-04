/**
 * Canon facts for a story, in server mode (FILM-1901, criterion 9).
 *
 * The `story` stage's output carries an optional `canonFacts` block. An
 * external agent submits it with the story; in server mode this
 * extracts it from the written story with the `canon-extraction` prompt,
 * the second model call the story handler always made. It runs inside the
 * story's stage writer (KB-184), so `commitStoryCanon` (`@kit/generation/canon`)
 * stores what it is given and never calls a model itself.
 *
 * Non-fatal: a failed extraction returns null and the story is still
 * committed, without threads or episode memory, as before.
 */
import {
  type CanonExtraction,
  CanonExtractionSchema,
  type Ctx,
} from '@kit/generation';

export interface ExtractCanonFactsInput {
  projectId: string;
  /** The account the job's LLM usage is recorded on (KB-129). */
  accountId: string;
  storyContent?: string;
  supabase: Ctx['client'];
}

/** Stories shorter than this carry nothing worth extracting. */
export const MIN_STORY_LENGTH_FOR_CANON = 100;

export async function extractCanonFacts({
  projectId,
  accountId,
  storyContent,
  supabase,
}: ExtractCanonFactsInput): Promise<CanonExtraction | null> {
  if (!storyContent || storyContent.length < MIN_STORY_LENGTH_FOR_CANON) {
    return null;
  }

  try {
    const { executeLLM } = await import('@kit/ai-gateway');

    // Fetch active threads for LLM context
    const { data: activeThreads } = await supabase
      .from('narrative_threads')
      .select('thread_name, thread_type, status, description, promises')
      .eq('project_id', projectId)
      .in('status', ['open', 'progressed']);

    const threadsContext = activeThreads?.length
      ? activeThreads
          .map(
            (t) =>
              `- "${t.thread_name}" (${t.thread_type}, ${t.status}): ${t.description ?? ''}. Promises: ${((t.promises as string[]) ?? []).join(', ') || 'none'}`,
          )
          .join('\n')
      : 'No active threads';

    // Fetch project characters
    const { data: projectCharacters } = await supabase
      .from('assets')
      .select('name, type')
      .eq('project_id', projectId)
      .eq('type', 'character')
      .limit(30);

    const charsContext = projectCharacters?.length
      ? projectCharacters.map((c) => `- ${c.name}`).join('\n')
      : 'No characters defined';

    // Sanitize content
    const sanitizedContent = storyContent
      .replace(/\b(system|assistant)\s*:\s*/gi, '')
      .replace(
        /\bignore\s+(all\s+)?(previous|above|prior)\s+(instructions?|prompts?|rules?)\b/gi,
        '',
      )
      .substring(0, 50_000)
      .trim();

    const result = await executeLLM<{ extraction: unknown }>({
      templateSlug: 'canon-extraction',
      variables: {
        story_content: sanitizedContent,
        existing_characters: charsContext,
        existing_threads: threadsContext,
      },
      context: {
        name: 'canon-extraction-auto',
        accountId,
      },
    });

    const parsed = CanonExtractionSchema.safeParse(result.data.extraction);

    if (!parsed.success) {
      console.warn(
        '[extractCanonFacts] The extraction does not fit the canon facts schema (non-fatal):',
        parsed.error.issues
          .map((issue) => `${issue.path.join('.')} ${issue.code}`)
          .join('; '),
      );
      return null;
    }

    console.log(
      `[extractCanonFacts] ${parsed.data.threadUpdates.length} thread updates extracted`,
    );

    return parsed.data;
  } catch (err) {
    console.warn('[extractCanonFacts] Extraction failed (non-fatal):', err);
    return null;
  }
}
