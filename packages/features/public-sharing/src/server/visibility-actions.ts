'use server';

import { revalidatePath } from 'next/cache';

import { z } from 'zod';

import { enhanceAction } from '@kit/next/actions';
import { requireAffectedRows, returnRefusals } from '@kit/next/refusals';
import { getSupabaseServerClient } from '@kit/supabase/server-client';

// Update Public Profile Schema
const UpdatePublicProfileSchema = z.object({
  accountId: z.string().uuid(),
  publicProfile: z.object({
    is_public: z.boolean(),
    display_name: z.string().optional(),
    bio: z.string().max(300).optional(),
    website_url: z.string().url().optional().or(z.literal('')),
    social_links: z
      .object({
        youtube: z.string().optional(),
        twitter: z.string().optional(),
        instagram: z.string().optional(),
        tiktok: z.string().optional(),
      })
      .optional(),
    custom_styles: z
      .object({
        primary_color: z.string().optional(),
        cover_image_url: z.string().optional(),
      })
      .optional(),
  }),
});

export const updatePublicProfileAction = returnRefusals(
  enhanceAction(
    async (data, user) => {
      const client = getSupabaseServerClient();

      // Check if user is owner or admin of the account
      const { data: membership } = await client
        .from('accounts_memberships')
        .select('account_role')
        .eq('account_id', data.accountId)
        .eq('user_id', user.id)
        .single();

      if (
        !membership ||
        !['owner', 'admin'].includes(membership.account_role)
      ) {
        throw new Error(
          'Unauthorized: You do not have permission to update this profile.',
        );
      }

      const { data: updated, error } = await client
        .from('accounts')
        .update({ public_profile: data.publicProfile })
        .eq('id', data.accountId)
        .select('id');

      if (error) {
        throw new Error(`Failed to update public profile: ${error.message}`);
      }

      requireAffectedRows(
        updated,
        "You can't change this account's public profile.",
      );

      revalidatePath('/', 'layout');
      return { success: true };
    },
    {
      schema: UpdatePublicProfileSchema,
      auth: true,
    },
  ),
);

// Update Project Visibility Schema
const UpdateProjectVisibilitySchema = z.object({
  projectId: z.string().uuid(),
  visibility: z.enum(['private', 'public', 'unlisted']),
  publicSlug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .min(3),
  seoMetadata: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
      keywords: z.array(z.string()).optional(),
    })
    .optional(),
});

export const updateProjectVisibilityAction = returnRefusals(
  enhanceAction(
    async (data) => {
      const client = getSupabaseServerClient();
      const { data: updated, error } = await client
        .from('projects')
        .update({
          visibility: data.visibility,
          public_slug: data.publicSlug,
          seo_metadata: data.seoMetadata ?? {},
        })
        .eq('id', data.projectId)
        .select('id');

      if (error) {
        throw new Error(
          `Failed to update project visibility: ${error.message}`,
        );
      }

      requireAffectedRows(
        updated,
        "You can't change this project's visibility.",
      );

      return { success: true };
    },
    {
      schema: UpdateProjectVisibilitySchema,
      auth: true,
    },
  ),
);

// Update Localized Videos Schema
const UpdateLocalizedVideosSchema = z.object({
  episodeId: z.string().uuid(),
  publicSlug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .min(3),
  visibility: z.enum(['inherit', 'private', 'public', 'unlisted']),
  // Record of language code -> platforms
  localizedVideos: z.record(
    z.string(),
    z.object({
      youtube: z
        .object({
          video_id: z.string(),
          url: z.string().url(),
          channel_id: z.string(),
        })
        .optional(),
      facebook: z
        .object({
          video_id: z.string(),
          url: z.string().url(),
          page_id: z.string(),
        })
        .optional(),
    }),
  ),
  seoMetadata: z
    .object({
      title: z.string().optional(),
      description: z.string().optional(),
    })
    .optional(),
});

export const updateEpisodePublicSettingsAction = returnRefusals(
  enhanceAction(
    async (data) => {
      const client = getSupabaseServerClient();

      const { data: updated, error } = await client
        .from('episodes')
        .update({
          public_slug: data.publicSlug,
          visibility: data.visibility,
          localized_videos: data.localizedVideos,
          seo_metadata: data.seoMetadata ?? {},
        })
        .eq('id', data.episodeId)
        .select('id');

      if (error) {
        throw new Error(`Failed to update episode settings: ${error.message}`);
      }

      requireAffectedRows(
        updated,
        "You can't change this episode's public settings.",
      );

      return { success: true };
    },
    {
      schema: UpdateLocalizedVideosSchema,
      auth: true,
    },
  ),
);

// Separate Episode Visibility Action (simpler)
const UpdateEpisodeVisibilitySchema = z.object({
  episodeId: z.string().uuid(),
  visibility: z.enum(['inherit', 'private', 'public', 'unlisted']),
  publicSlug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .min(3)
    .max(50)
    .optional(),
});

export const updateEpisodeVisibilityAction = returnRefusals(
  enhanceAction(
    async (data) => {
      const client = getSupabaseServerClient();
      const updateData: Record<string, unknown> = {
        visibility: data.visibility,
      };
      if (data.publicSlug) {
        updateData.public_slug = data.publicSlug;
      }

      const { data: updated, error } = await client
        .from('episodes')
        .update(updateData)
        .eq('id', data.episodeId)
        .select('id');

      if (error) {
        throw new Error(
          `Failed to update episode visibility: ${error.message}`,
        );
      }

      requireAffectedRows(
        updated,
        "You can't change this episode's visibility.",
      );

      return { success: true };
    },
    {
      schema: UpdateEpisodeVisibilitySchema,
      auth: true,
    },
  ),
);

// Separate Localized Videos Action
const UpdateLocalizedVideosOnlySchema = z.object({
  episodeId: z.string().uuid(),
  localizedVideos: z.record(
    z.string(),
    z.object({
      youtube: z
        .object({
          video_id: z.string(),
          url: z.string().url(),
          channel_id: z.string(),
        })
        .optional(),
      facebook: z
        .object({
          video_id: z.string(),
          url: z.string().url(),
          page_id: z.string(),
        })
        .optional(),
    }),
  ),
});

export const updateLocalizedVideosAction = returnRefusals(
  enhanceAction(
    async (data) => {
      const client = getSupabaseServerClient();

      const { data: updated, error } = await client
        .from('episodes')
        .update({
          localized_videos: data.localizedVideos,
        })
        .eq('id', data.episodeId)
        .select('id');

      if (error) {
        throw new Error(`Failed to update localized videos: ${error.message}`);
      }

      requireAffectedRows(
        updated,
        "You can't change this episode's video links.",
      );

      return { success: true };
    },
    {
      schema: UpdateLocalizedVideosOnlySchema,
      auth: true,
    },
  ),
);
