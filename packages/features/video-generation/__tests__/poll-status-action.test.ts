import { describe, expect, it } from 'vitest';

import {
  type PollVideoStatusResponse,
  PollVideoStatusResponseSchema,
  PollVideoStatusSchema,
} from '../src/lib/schemas';

describe('PollVideoStatusSchema', () => {
  it('should accept generationJobId', () => {
    const result = PollVideoStatusSchema.safeParse({
      generationJobId: '123e4567-e89b-12d3-a456-426614174000',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.generationJobId).toBe(
        '123e4567-e89b-12d3-a456-426614174000',
      );
    }
  });

  it('should accept jobId for backward compatibility', () => {
    const result = PollVideoStatusSchema.safeParse({
      jobId: '123e4567-e89b-12d3-a456-426614174000',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.generationJobId).toBe(
        '123e4567-e89b-12d3-a456-426614174000',
      );
    }
  });

  it('should prefer generationJobId over jobId', () => {
    const result = PollVideoStatusSchema.safeParse({
      generationJobId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      jobId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.generationJobId).toBe(
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      );
    }
  });

  it('should reject when neither field is provided', () => {
    const result = PollVideoStatusSchema.safeParse({});

    expect(result.success).toBe(false);
  });

  it('should reject invalid UUID', () => {
    const result = PollVideoStatusSchema.safeParse({
      generationJobId: 'not-a-uuid',
    });

    expect(result.success).toBe(false);
  });

  it('should reject null values', () => {
    const result = PollVideoStatusSchema.safeParse({
      generationJobId: null,
    });

    expect(result.success).toBe(false);
  });
});

describe('PollVideoStatusResponseSchema', () => {
  it('should validate a complete response', () => {
    const response: PollVideoStatusResponse = {
      status: 'completed',
      progress: 100,
      videoUrl: 'https://example.com/video.mp4',
      thumbnailUrl: 'https://example.com/thumb.jpg',
      lastUpdated: '2024-01-01T00:00:00Z',
    };

    const result = PollVideoStatusResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
  });

  it('should validate a minimal response', () => {
    const response = {
      status: 'processing',
      lastUpdated: '2024-01-01T00:00:00Z',
    };

    const result = PollVideoStatusResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
  });

  it('should accept all valid status values', () => {
    const statuses = ['queued', 'processing', 'completed', 'failed'];

    for (const status of statuses) {
      const result = PollVideoStatusResponseSchema.safeParse({
        status,
        lastUpdated: '2024-01-01T00:00:00Z',
      });
      expect(result.success).toBe(true);
    }
  });

  it('should reject invalid status', () => {
    const result = PollVideoStatusResponseSchema.safeParse({
      status: 'invalid',
      lastUpdated: '2024-01-01T00:00:00Z',
    });

    expect(result.success).toBe(false);
  });

  it('should accept optional fields', () => {
    const response = {
      status: 'processing',
      progress: 50,
      estimatedTimeRemaining: 120,
      queuePosition: 5,
      lastUpdated: '2024-01-01T00:00:00Z',
    };

    const result = PollVideoStatusResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
  });

  it('should validate error response', () => {
    const response = {
      status: 'failed',
      errorMessage: 'Provider error occurred',
      lastUpdated: '2024-01-01T00:00:00Z',
    };

    const result = PollVideoStatusResponseSchema.safeParse(response);
    expect(result.success).toBe(true);
  });

  it('should require lastUpdated', () => {
    const result = PollVideoStatusResponseSchema.safeParse({
      status: 'completed',
    });

    expect(result.success).toBe(false);
  });
});
