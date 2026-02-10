/**
 * Archive.org Provider
 * Phase 11: FILM-1135
 *
 * Fetches historical content from the Internet Archive.
 * Free API — no key required.
 */

import { BaseExternalProvider } from './base-provider';
import type {
    ExternalSearchParams,
    ExternalContent,
    SourceCategory,
} from '../../../types/external-context';
import { createEmptyEntities } from '../../../types/external-context';

interface ArchiveOrgDoc {
    identifier: string;
    title: string;
    description: string | null;
    creator: string | string[] | null;
    date: string | null;
    language: string | null;
    mediatype: string;
}

interface ArchiveOrgResponse {
    response: {
        numFound: number;
        docs: ArchiveOrgDoc[];
    };
}

export class ArchiveOrgProvider extends BaseExternalProvider {
    readonly name = 'Internet Archive';
    readonly category: SourceCategory = 'historical';
    readonly sourceId: string;

    constructor(sourceId: string) {
        super();
        this.sourceId = sourceId;
        this.cacheTTLHours = 720; // 30 days — historical content doesn't change
    }

    async fetchContent(params: ExternalSearchParams): Promise<ExternalContent[]> {
        const url = new URL('https://archive.org/advancedsearch.php');
        url.searchParams.set('q', params.query);
        url.searchParams.set('output', 'json');
        url.searchParams.set('rows', String(params.pageSize ?? 20));
        url.searchParams.set(
            'fl[]',
            'identifier,title,description,creator,date,language,mediatype',
        );

        if (params.page && params.page > 1) {
            url.searchParams.set('page', String(params.page));
        }

        const response = await fetch(url.toString(), {
            signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
            throw new Error(`Archive.org error: ${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as ArchiveOrgResponse;
        const cacheExpiry = this.getCacheExpiryDate();
        const now = new Date();

        return (data.response?.docs ?? []).map((doc) => ({
            id: '',
            externalId: `archive:${doc.identifier}`,
            sourceId: this.sourceId,
            title: doc.title,
            description: doc.description ?? '',
            content: null, // Archive.org doesn't return full text in search
            url: `https://archive.org/details/${doc.identifier}`,
            authors: this.normalizeCreator(doc.creator),
            publishedAt: doc.date ? new Date(doc.date) : new Date(),
            language: doc.language ?? 'en',
            category: 'historical',
            topics: [],
            entities: createEmptyEntities(),
            credibilityTier: 'tier_2',
            fetchedAt: now,
            cacheExpiresAt: cacheExpiry,
        }));
    }

    private normalizeCreator(creator: string | string[] | null): string[] {
        if (!creator) return [];
        return Array.isArray(creator) ? creator : [creator];
    }
}
