import { z } from 'zod';

import { YOUTUBE_CATEGORY_IDS } from '../youtube-declaration';

/**
 * A YouTube channel's declaration (KB-30), as the audience dialog and the
 * Settings → Platforms row collect it. Neither field has a default: the
 * form starts empty and cannot be submitted until both are answered.
 */
export const YouTubeChannelDeclarationSchema = z.object({
  madeForKids: z.boolean({
    required_error: 'Choose whether this channel is made for kids',
    invalid_type_error: 'Choose whether this channel is made for kids',
  }),
  categoryId: z.enum(YOUTUBE_CATEGORY_IDS, {
    required_error: 'Choose a category',
    invalid_type_error: 'Choose a category',
  }),
});

export const UpdateYouTubeChannelSettingsSchema =
  YouTubeChannelDeclarationSchema.extend({
    connectionId: z.string().uuid(),
  });

/** The audience dialog: one declaration per undeclared channel. */
export const YouTubeAudienceFormSchema = z.object({
  channels: z.array(
    YouTubeChannelDeclarationSchema.extend({
      connectionId: z.string().uuid(),
    }),
  ),
});
