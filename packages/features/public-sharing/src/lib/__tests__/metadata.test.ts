import { describe, expect, it } from 'vitest';

import {
  PublicAccount,
  PublicEpisode,
  PublicProject,
} from '../../server/public-queries';
import {
  generateCompanyMetadata,
  generateEpisodeMetadata,
  generateProjectMetadata,
} from '../metadata';

describe('Metadata Generation', () => {
  describe('generateCompanyMetadata', () => {
    it('should generate correct metadata for a company', () => {
      const company: PublicAccount = {
        id: '123',
        name: 'ACME Corp',
        slug: 'acme',
        picture_url: 'https://example.com/logo.png',
        public_profile: {
          is_public: true,
          bio: 'Best company',
          display_name: 'ACME Corp Display',
        },
      };

      const metadata = generateCompanyMetadata(company);

      expect(metadata.title).toBe('ACME Corp Display');
      expect(metadata.description).toBe('Best company');
      expect(metadata.openGraph?.images).toContain(
        'https://example.com/logo.png',
      );
    });
  });

  describe('generateProjectMetadata', () => {
    it('should generate correct metadata for a project', () => {
      const project = {
        id: 'p1',
        name: 'My Series',
        public_slug: 'my-series',
        description: 'A great series',
        visibility: 'public',
        account: {
          id: '123',
          name: 'ACME Corp',
          slug: 'acme',
        },
      } as PublicProject;

      const metadata = generateProjectMetadata(project);

      expect(metadata.title).toBe('My Series | ACME Corp');
      expect(metadata.description).toBe('A great series');
      // Assuming default logic falls back to account info if no images
    });
  });
});
