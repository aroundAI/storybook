import { describe, expect, it } from 'vitest';

import { inferCategory } from '../src/lib/server/services/producer-service';

describe('inferCategory', () => {
    it('should return "breaking" for breaking/urgent headlines', () => {
        expect(inferCategory('BREAKING: Major earthquake strikes')).toBe(
            'breaking',
        );
        expect(inferCategory('Urgent recall issued for food products')).toBe(
            'breaking',
        );
    });

    it('should return "politics" for political headlines', () => {
        expect(inferCategory('Election results are in')).toBe('politics');
        expect(inferCategory('Congress passes new bill')).toBe('politics');
        expect(inferCategory('President signs executive order')).toBe(
            'politics',
        );
        expect(inferCategory('Government shutdown looms')).toBe('politics');
    });

    it('should return "business" for finance/economy headlines', () => {
        expect(inferCategory('Stock market hits record high')).toBe(
            'business',
        );
        expect(inferCategory('Economy shows signs of recovery')).toBe(
            'business',
        );
        expect(inferCategory('New trade deal announced')).toBe('business');
        expect(inferCategory('Market volatility continues')).toBe('business');
    });

    it('should return "tech" for technology headlines', () => {
        expect(inferCategory('New AI model surpasses benchmarks')).toBe('tech');
        expect(inferCategory('Tech giants face antitrust probe')).toBe('tech');
        expect(inferCategory('Cyber attack hits major company')).toBe('tech');
        expect(inferCategory('Software update causes outage')).toBe('tech');
    });

    it('should return "health" for medical/health headlines', () => {
        expect(inferCategory('New health guidelines released')).toBe('health');
        expect(inferCategory('Medical breakthrough in cancer research')).toBe(
            'health',
        );
        expect(inferCategory('New vaccine approved by FDA')).toBe('health');
        expect(inferCategory('Disease outbreak reported')).toBe('health');
    });

    it('should return "feature" for unrecognized headlines', () => {
        expect(inferCategory('Local artist wins community award')).toBe(
            'feature',
        );
        expect(inferCategory('A day in the life of a firefighter')).toBe(
            'feature',
        );
        expect(inferCategory('Recipe for the perfect pie')).toBe('feature');
    });

    it('should be case-insensitive', () => {
        expect(inferCategory('BREAKING NEWS')).toBe('breaking');
        expect(inferCategory('ELECTION DAY')).toBe('politics');
        expect(inferCategory('STOCK MARKET CRASH')).toBe('business');
    });

    it('should prioritize earlier categories (breaking > politics)', () => {
        // "breaking" + "election" → should return "breaking" (checked first)
        expect(inferCategory('Breaking: Election fraud alleged')).toBe(
            'breaking',
        );
    });
});
