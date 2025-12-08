import { z } from 'zod';

// Common enums and types
export const UUIDSchema = z.string().uuid();
export const URLSchema = z.string().url();
export const EmailSchema = z.string().email();

export const TimestampSchema = z.string().datetime();

export const PaginationSchema = z.object({
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(100).default(20),
  offset: z.number().int().nonnegative().optional(),
});

export const SortOrderSchema = z.enum(['asc', 'desc']);

export const MetadataSchema = z.record(z.unknown());

// Type exports
export type UUID = z.infer<typeof UUIDSchema>;
export type Pagination = z.infer<typeof PaginationSchema>;
export type SortOrder = z.infer<typeof SortOrderSchema>;
export type Metadata = z.infer<typeof MetadataSchema>;
