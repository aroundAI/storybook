import { z } from 'zod';

/**
 * Supported platforms for upload-only mode
 */
export const PlatformSchema = z.enum([
  'youtube',
  'tiktok',
  'instagram',
  'facebook',
]);

/**
 * Schema for generating an export package
 */
export const GenerateExportPackageSchema = z.object({
  /** Episode ID to generate package for */
  episodeId: z.string().uuid('Invalid episode ID format'),
  /** Target platform */
  platform: PlatformSchema,
});

export type GenerateExportPackageInput = z.infer<
  typeof GenerateExportPackageSchema
>;

/**
 * Schema for marking content as externally uploaded
 */
export const MarkAsExternallyUploadedSchema = z.object({
  /** Episode ID that was uploaded */
  episodeId: z.string().uuid('Invalid episode ID format'),
  /** Platform where content was uploaded */
  platform: PlatformSchema,
  /** URL of the uploaded content on the platform */
  platformUrl: z.string().url('Please enter a valid URL'),
});

export type MarkAsExternallyUploadedInput = z.infer<
  typeof MarkAsExternallyUploadedSchema
>;
