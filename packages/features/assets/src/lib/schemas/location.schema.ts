import { z } from 'zod';

/**
 * What the location editor validates (`components/location-editor.tsx`),
 * shared with the MCP `upsert_asset` tool (FILM-1905) so both refuse the
 * same input. The editor stores the detail fields in `assets.metadata`.
 */
export const LocationFormSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  description: z.string().max(1000).optional(),
  fileUrl: z.string().optional(),
  thumbnailUrl: z.string().optional(),
  setting: z.string().optional(),
  timeOfDay: z.string().optional(),
  weather: z.string().optional(),
  atmosphere: z.string().optional(),
  referenceImages: z.array(z.string()).optional(),
});

export type LocationFormData = z.infer<typeof LocationFormSchema>;

/** The detail fields the editor writes into `assets.metadata` for a location. */
export const LocationDetailsSchema = LocationFormSchema.pick({
  setting: true,
  timeOfDay: true,
  weather: true,
  atmosphere: true,
  referenceImages: true,
});

export type LocationDetails = z.infer<typeof LocationDetailsSchema>;
