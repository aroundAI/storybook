import { describe, expect, it } from 'vitest';

import {
    CONTENT_TYPE_CONFIGS,
    getContentTypeConfig,
} from '../src/lib/canon/content-type-configs';

describe('Content Type Configs (FILM-1110)', () => {
    describe('CONTENT_TYPE_CONFIGS', () => {
        it('should define configs for all 6 project types', () => {
            const types = Object.keys(CONTENT_TYPE_CONFIGS);
            expect(types).toEqual(
                expect.arrayContaining([
                    'short-film',
                    'series',
                    'documentary',
                    'ad',
                    'educational',
                    'news',
                ]),
            );
            expect(types).toHaveLength(6);
        });

        it('should have allocations that sum to 100 for each type', () => {
            for (const [type, config] of Object.entries(CONTENT_TYPE_CONFIGS)) {
                const alloc = config.allocations;
                const sum =
                    alloc.events +
                    alloc.characters +
                    alloc.world +
                    alloc.threads +
                    alloc.summaries +
                    (alloc.facts ?? 0) +
                    (alloc.external ?? 0);
                expect(sum).toBe(100);
            }
        });

        it('should have contextWindowPercent between 1 and 50', () => {
            for (const config of Object.values(CONTENT_TYPE_CONFIGS)) {
                expect(config.contextWindowPercent).toBeGreaterThanOrEqual(1);
                expect(config.contextWindowPercent).toBeLessThanOrEqual(50);
            }
        });

        it('should have memoryHorizon > 0 for all types', () => {
            for (const config of Object.values(CONTENT_TYPE_CONFIGS)) {
                expect(config.memoryHorizon).toBeGreaterThan(0);
            }
        });

        it('should require facts for documentary, educational, and news', () => {
            expect(CONTENT_TYPE_CONFIGS['documentary'].requiresFacts).toBe(true);
            expect(CONTENT_TYPE_CONFIGS['educational'].requiresFacts).toBe(true);
            expect(CONTENT_TYPE_CONFIGS['news'].requiresFacts).toBe(true);
        });

        it('should not require facts for short-film, series, and ad', () => {
            expect(CONTENT_TYPE_CONFIGS['short-film'].requiresFacts).toBe(false);
            expect(CONTENT_TYPE_CONFIGS['series'].requiresFacts).toBe(false);
            expect(CONTENT_TYPE_CONFIGS['ad'].requiresFacts).toBe(false);
        });

        it('should require external context for documentary and news only', () => {
            expect(
                CONTENT_TYPE_CONFIGS['documentary'].requiresExternalContext,
            ).toBe(true);
            expect(CONTENT_TYPE_CONFIGS['news'].requiresExternalContext).toBe(true);

            expect(
                CONTENT_TYPE_CONFIGS['short-film'].requiresExternalContext,
            ).toBe(false);
            expect(CONTENT_TYPE_CONFIGS['series'].requiresExternalContext).toBe(
                false,
            );
            expect(CONTENT_TYPE_CONFIGS['ad'].requiresExternalContext).toBe(false);
            expect(
                CONTENT_TYPE_CONFIGS['educational'].requiresExternalContext,
            ).toBe(false);
        });

        it('should have at least one role for every type', () => {
            for (const config of Object.values(CONTENT_TYPE_CONFIGS)) {
                expect(config.roles.length).toBeGreaterThan(0);
            }
        });
    });

    describe('getContentTypeConfig', () => {
        it('should return the correct config for known types', () => {
            const config = getContentTypeConfig('documentary');
            expect(config.requiresFacts).toBe(true);
            expect(config.decayFunction).toBe('topic_match');
        });

        it('should return short-film config for short-film type', () => {
            const config = getContentTypeConfig('short-film');
            expect(config.decayFunction).toBe('exponential');
            expect(config.enforcement).toBe('strict');
        });

        it('should return news config with external context', () => {
            const config = getContentTypeConfig('news');
            expect(config.requiresExternalContext).toBe(true);
            expect(config.allocations.external).toBe(65);
        });
    });
});
