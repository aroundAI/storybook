'use client';

import { useCallback, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import { Linkedin } from 'lucide-react';
import { toast } from '@kit/ui/sonner';

import { NotesInput, PostsList } from '@kit/publishing/components/social-posts';

import {
  createSocialPostAction,
  deleteSocialPostAction,
  publishSocialPostAction,
  regenerateVariantsAction,
} from '@kit/publishing/server/social-posts';

interface SocialPostsDashboardProps {
  accountId: string;
  accountSlug: string;
  initialPosts?: Array<{
    id: string;
    raw_notes: string;
    final_text: string | null;
    hashtags: string[];
    platform: string;
    status: string;
    platform_url: string | null;
    created_at: string;
    updated_at: string;
    generated_variants: Array<{
      text: string;
      style: string;
      hashtags: string[];
    }>;
    selected_variant_index: number;
    visibility: string;
  }>;
}

export function SocialPostsDashboard({
  accountId,
  accountSlug,
  initialPosts = [],
}: SocialPostsDashboardProps) {
  const router = useRouter();
  const [posts] = useState(initialPosts);
  const [publishingIds, setPublishingIds] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const handleCreatePost = useCallback(
    async (data: {
      rawNotes: string;
      enableResearch: boolean;
      tone: string;
      authorContext: string;
    }) => {
      try {
        const result = await createSocialPostAction({
          accountId,
          rawNotes: data.rawNotes,
          enableResearch: data.enableResearch,
          tone: data.tone || undefined,
          authorContext: data.authorContext || undefined,
        });

        toast.success(
          `Generated ${result.variantCount} LinkedIn post variant${result.variantCount !== 1 ? 's' : ''}`,
          {
            description: 'Review and approve your post before publishing.',
          },
        );

        router.refresh();

        // Navigate to the new post detail page
        router.push(
          `/home/${accountSlug}/social-posts/${result.postId}`,
        );
      } catch (error) {
        toast.error('Failed to create post', {
          description:
            error instanceof Error ? error.message : 'Unknown error',
        });
      }
    },
    [accountId, accountSlug, router],
  );

  const handleViewPost = useCallback(
    (postId: string) => {
      router.push(`/home/${accountSlug}/social-posts/${postId}`);
    },
    [accountSlug, router],
  );

  const handlePublishPost = useCallback(
    (postId: string) => {
      setPublishingIds((prev) => new Set(prev).add(postId));

      startTransition(async () => {
        try {
          const result = await publishSocialPostAction({ postId });
          if (result.success) {
            toast.success('Post published to LinkedIn!', {
              description: 'Your post is now live.',
              action: result.postUrl
                ? {
                    label: 'View',
                    onClick: () => window.open(result.postUrl!, '_blank'),
                  }
                : undefined,
            });
            router.refresh();
          }
        } catch (error) {
          toast.error('Failed to publish', {
            description:
              error instanceof Error ? error.message : 'Unknown error',
          });
        } finally {
          setPublishingIds((prev) => {
            const next = new Set(prev);
            next.delete(postId);
            return next;
          });
        }
      });
    },
    [router],
  );

  const handleDeletePost = useCallback(
    (postId: string) => {
      startTransition(async () => {
        try {
          await deleteSocialPostAction({ postId });
          toast.success('Post deleted');
          router.refresh();
        } catch (error) {
          toast.error('Failed to delete post', {
            description:
              error instanceof Error ? error.message : 'Unknown error',
          });
        }
      });
    },
    [router],
  );

  const handleRegeneratePost = useCallback(
    (postId: string) => {
      startTransition(async () => {
        try {
          const result = await regenerateVariantsAction({ postId });
          toast.success(
            `Regenerated ${result.variantCount} new variants`,
          );
          router.refresh();
          router.push(`/home/${accountSlug}/social-posts/${postId}`);
        } catch (error) {
          toast.error('Failed to regenerate', {
            description:
              error instanceof Error ? error.message : 'Unknown error',
          });
        }
      });
    },
    [accountSlug, router],
  );

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0A66C2]/10">
          <Linkedin className="h-5 w-5 text-[#0A66C2]" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">LinkedIn Posts</h2>
          <p className="text-muted-foreground text-sm">
            Paste your notes, generate variants, review, and publish.
          </p>
        </div>
      </div>

      {/* Notes Input */}
      <NotesInput onSubmit={handleCreatePost} disabled={isPending} />

      {/* Posts List */}
      <div>
        <h3 className="mb-3 text-base font-semibold">Your Posts</h3>
        <PostsList
          posts={posts}
          onView={handleViewPost}
          onPublish={handlePublishPost}
          onDelete={handleDeletePost}
          onRegenerate={handleRegeneratePost}
          publishingIds={publishingIds}
        />
      </div>
    </div>
  );
}
