import { describe, expect, it } from 'vitest';

import { generateAPACitation } from '../../types/verified-facts';

describe('generateAPACitation', () => {
    it('should generate citation with DOI', () => {
        const citation = generateAPACitation(
            ['Smith, J.', 'Doe, A.'],
            2023,
            'The Science of Everything',
            'Nature',
            undefined,
            '10.1234/nature.12345',
        );

        expect(citation).toBe(
            'Smith, J., Doe, A. (2023). The Science of Everything. Nature. https://doi.org/10.1234/nature.12345',
        );
    });

    it('should generate citation with URL when no DOI provided', () => {
        const citation = generateAPACitation(
            ['Johnson, R.'],
            2022,
            'History of Science',
            'Oxford Press',
            'https://example.com/article',
        );

        expect(citation).toBe(
            'Johnson, R. (2022). History of Science. Oxford Press. Retrieved from https://example.com/article',
        );
    });

    it('should prefer DOI over URL when both provided', () => {
        const citation = generateAPACitation(
            ['Lee, K.'],
            2024,
            'Quantum Computing',
            'Science',
            'https://example.com',
            '10.5678/science.9999',
        );

        expect(citation).toBe(
            'Lee, K. (2024). Quantum Computing. Science. https://doi.org/10.5678/science.9999',
        );
    });

    it('should use "Unknown Author" when authors array is empty', () => {
        const citation = generateAPACitation(
            [],
            2020,
            'Anonymous Report',
            'Government Publication',
        );

        expect(citation).toBe(
            'Unknown Author (2020). Anonymous Report. Government Publication.',
        );
    });

    it('should handle citation with no DOI and no URL', () => {
        const citation = generateAPACitation(
            ['Garcia, M.'],
            2019,
            'Textbook of Biology',
            'Pearson',
        );

        expect(citation).toBe(
            'Garcia, M. (2019). Textbook of Biology. Pearson.',
        );
    });

    it('should handle single author', () => {
        const citation = generateAPACitation(
            ['Einstein, A.'],
            1905,
            'On the Electrodynamics of Moving Bodies',
            'Annalen der Physik',
        );

        expect(citation).toBe(
            'Einstein, A. (1905). On the Electrodynamics of Moving Bodies. Annalen der Physik.',
        );
    });

    it('should handle multiple authors', () => {
        const citation = generateAPACitation(
            ['Watson, J. D.', 'Crick, F. H. C.'],
            1953,
            'Molecular Structure of Nucleic Acids',
            'Nature',
        );

        expect(citation).toBe(
            'Watson, J. D., Crick, F. H. C. (1953). Molecular Structure of Nucleic Acids. Nature.',
        );
    });
});
