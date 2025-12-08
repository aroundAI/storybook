import { describe, expect, it } from 'vitest';

import {
  EmailSchema,
  MetadataSchema,
  PaginationSchema,
  SortOrderSchema,
  TimestampSchema,
  URLSchema,
  UUIDSchema,
} from '../src/common';

describe('Common Schemas', () => {
  describe('UUIDSchema', () => {
    it('should accept valid UUIDs', () => {
      const validUUID = '123e4567-e89b-12d3-a456-426614174000';
      expect(UUIDSchema.safeParse(validUUID).success).toBe(true);
    });

    it('should reject invalid UUIDs', () => {
      expect(UUIDSchema.safeParse('not-a-uuid').success).toBe(false);
      expect(UUIDSchema.safeParse('').success).toBe(false);
      expect(UUIDSchema.safeParse(123).success).toBe(false);
    });
  });

  describe('URLSchema', () => {
    it('should accept valid URLs', () => {
      expect(URLSchema.safeParse('https://example.com').success).toBe(true);
      expect(URLSchema.safeParse('http://localhost:3000').success).toBe(true);
      expect(
        URLSchema.safeParse('https://example.com/path?query=value').success,
      ).toBe(true);
    });

    it('should reject invalid URLs', () => {
      expect(URLSchema.safeParse('not-a-url').success).toBe(false);
      expect(URLSchema.safeParse('').success).toBe(false);
      expect(URLSchema.safeParse('example.com').success).toBe(false);
    });

    it('should accept other valid URL schemes', () => {
      // Zod url() accepts any valid URL, not just http/https
      expect(URLSchema.safeParse('ftp://example.com').success).toBe(true);
    });
  });

  describe('EmailSchema', () => {
    it('should accept valid emails', () => {
      expect(EmailSchema.safeParse('test@example.com').success).toBe(true);
      expect(EmailSchema.safeParse('user.name@domain.co.uk').success).toBe(
        true,
      );
    });

    it('should reject invalid emails', () => {
      expect(EmailSchema.safeParse('not-an-email').success).toBe(false);
      expect(EmailSchema.safeParse('@example.com').success).toBe(false);
      expect(EmailSchema.safeParse('test@').success).toBe(false);
    });
  });

  describe('TimestampSchema', () => {
    it('should accept valid ISO datetime strings', () => {
      expect(TimestampSchema.safeParse('2024-01-01T00:00:00Z').success).toBe(
        true,
      );
      expect(
        TimestampSchema.safeParse('2024-12-31T23:59:59.999Z').success,
      ).toBe(true);
    });

    it('should reject invalid datetime strings', () => {
      expect(TimestampSchema.safeParse('2024-01-01').success).toBe(false);
      expect(TimestampSchema.safeParse('not-a-date').success).toBe(false);
    });
  });

  describe('PaginationSchema', () => {
    it('should accept valid pagination params', () => {
      const result = PaginationSchema.safeParse({ page: 1, limit: 20 });
      expect(result.success).toBe(true);
    });

    it('should apply defaults', () => {
      const result = PaginationSchema.parse({});
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it('should reject invalid page numbers', () => {
      expect(PaginationSchema.safeParse({ page: 0 }).success).toBe(false);
      expect(PaginationSchema.safeParse({ page: -1 }).success).toBe(false);
    });

    it('should reject limit over 100', () => {
      expect(PaginationSchema.safeParse({ limit: 101 }).success).toBe(false);
    });

    it('should accept optional offset', () => {
      const result = PaginationSchema.safeParse({ page: 1, offset: 10 });
      expect(result.success).toBe(true);
    });

    it('should reject negative offset', () => {
      expect(PaginationSchema.safeParse({ offset: -1 }).success).toBe(false);
    });
  });

  describe('SortOrderSchema', () => {
    it('should accept valid sort orders', () => {
      expect(SortOrderSchema.safeParse('asc').success).toBe(true);
      expect(SortOrderSchema.safeParse('desc').success).toBe(true);
    });

    it('should reject invalid sort orders', () => {
      expect(SortOrderSchema.safeParse('ascending').success).toBe(false);
      expect(SortOrderSchema.safeParse('').success).toBe(false);
    });
  });

  describe('MetadataSchema', () => {
    it('should accept any record', () => {
      expect(MetadataSchema.safeParse({}).success).toBe(true);
      expect(MetadataSchema.safeParse({ key: 'value' }).success).toBe(true);
      expect(MetadataSchema.safeParse({ nested: { deep: true } }).success).toBe(
        true,
      );
    });

    it('should reject non-objects', () => {
      expect(MetadataSchema.safeParse('string').success).toBe(false);
      expect(MetadataSchema.safeParse(123).success).toBe(false);
    });
  });
});
