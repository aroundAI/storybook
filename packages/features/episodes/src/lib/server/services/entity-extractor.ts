/**
 * Entity Extractor
 * Phase 11: FILM-1131
 *
 * Uses LLM to extract named entities (people, orgs, locations, topics, events)
 * from external content. Best-effort: failures return empty entities.
 */

import type { ExtractedEntities } from '../../../types/external-context';
import { createEmptyEntities } from '../../../types/external-context';

/** Maximum content length passed to LLM (chars → ~666 tokens) */
const MAX_CONTENT_LENGTH = 2000;

/**
 * Extract named entities from article content via LLM.
 *
 * @param title    - Article headline
 * @param content  - Article body text (truncated to MAX_CONTENT_LENGTH)
 * @param context  - Logging context with accountId (required by executeLLM)
 * @returns Extracted entities, or empty entities on failure
 */
export async function extractEntitiesFromArticle(
    title: string,
    content: string,
    context: { accountId: string },
): Promise<ExtractedEntities> {
    try {
        const { executeLLM } = await import('@kit/prompt-engine/server');

        const result = await executeLLM<{
            people: Array<{ name: string; role?: string }>;
            organizations: Array<{ name: string; type?: string }>;
            locations: Array<{ name: string; type: string }>;
            topics: string[];
            events: Array<{ name: string; date?: string }>;
        }>({
            templateSlug: 'news-generation/entity-extraction',
            variables: {
                title,
                content: content.slice(0, MAX_CONTENT_LENGTH),
            },
            context: {
                name: 'entity-extraction',
                accountId: context.accountId,
            },
        });

        return {
            people: result.data.people ?? [],
            organizations: result.data.organizations ?? [],
            locations: result.data.locations ?? [],
            topics: result.data.topics ?? [],
            events: result.data.events ?? [],
            extractedAt: new Date(),
        };
    } catch (err) {
        console.error(
            '[entity-extractor] Failed to extract entities:',
            err,
        );

        return createEmptyEntities();
    }
}

/**
 * Merge entity arrays from multiple extractions, deduplicating by name.
 */
export function mergeEntities(
    entitiesList: ExtractedEntities[],
): ExtractedEntities {
    const merged: ExtractedEntities = {
        people: [],
        organizations: [],
        locations: [],
        topics: [],
        events: [],
        extractedAt: new Date(),
    };

    for (const entities of entitiesList) {
        merged.people.push(...entities.people);
        merged.organizations.push(...entities.organizations);
        merged.locations.push(...entities.locations);
        merged.topics.push(...entities.topics);
        merged.events.push(...entities.events);
    }

    // Deduplicate by lowercased name
    merged.people = dedupeByName(merged.people);
    merged.organizations = dedupeByName(merged.organizations);
    merged.locations = dedupeByName(merged.locations);
    merged.topics = [...new Set(merged.topics)];
    merged.events = dedupeByName(merged.events);

    return merged;
}

/** Deduplicate by name, preferring the entry with more non-empty fields */
function dedupeByName<T extends { name: string }>(items: T[]): T[] {
    const seen = new Map<string, T>();

    for (const item of items) {
        const key = item.name.toLowerCase();
        const existing = seen.get(key);

        if (!existing || countFields(item) > countFields(existing)) {
            seen.set(key, item);
        }
    }

    return Array.from(seen.values());
}

function countFields(obj: Record<string, unknown>): number {
    return Object.values(obj).filter(
        (v) => v !== undefined && v !== null && v !== '',
    ).length;
}
