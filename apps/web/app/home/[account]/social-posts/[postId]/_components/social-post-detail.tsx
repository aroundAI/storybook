'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';

import { useRouter } from 'next/navigation';

import {
  ArrowLeft,
  CheckCircle2,
  ExternalLink,
  Linkedin,
  Loader2,
  RefreshCw,
  Send,
} from 'lucide-react';

import { VariantSelector } from '@kit/publishing/components/social-posts';
import { getConnectedPlatformsAction } from '@kit/publishing/server';
import {
  approveSocialPostAction,
  getSocialPostAction,
  publishSocialPostAction,
  regenerateVariantsAction,
  updateSocialPostAction,
} from '@kit/publishing/server/social-posts';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';

interface SocialPostDetailProps {
  postId: string;
  accountSlug: string;
  accountId: string;
}

interface PostVariant {
  text: string;
  style: string;
  hashtags: string[];
  hookPreview: string;
}

interface SocialPostState {
  id: string;
  raw_notes: string;
  final_text: string | null;
  hashtags: string[];
  platform: string;
  status: string;
  platform_url: string | null;
  platform_connection_id: string | null;
  generated_variants: PostVariant[];
  selected_variant_index: number;
  visibility: string;
  research_context: Record<string, unknown> | null;
}

interface PlatformConnectionDisplay {
  id: string;
  platform: string;
  platformAccountName: string;
  isActive: boolean;
}

function mapPostToState(postData: Record<string, unknown>): SocialPostState {
  return {
    id: postData.id as string,
    raw_notes: postData.raw_notes as string,
    final_text: (postData.final_text as string) ?? null,
    hashtags: (postData.hashtags as string[]) ?? [],
    platform: (postData.platform as string) ?? 'linkedin',
    status: postData.status as string,
    platform_url: (postData.platform_url as string) ?? null,
    platform_connection_id: (postData.platform_connection_id as string) ?? null,
    generated_variants: (postData.generated_variants as PostVariant[]) ?? [],
    selected_variant_index: (postData.selected_variant_index as number) ?? 0,
    visibility: (postData.visibility as string) ?? 'PUBLIC',
    research_context:
      (postData.research_context as Record<string, unknown>) ?? null,
  };
}

export function SocialPostDetail({
  postId,
  accountSlug,
  accountId,
}: SocialPostDetailProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [post, setPost] = useState<SocialPostState | null>(null);
  const [connections, setConnections] = useState<PlatformConnectionDisplay[]>(
    [],
  );
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('');
  const [isLoaded, setIsLoaded] = useState(false);
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Load post data on mount

  useEffect(() => {
    if (isLoaded) return;
    startTransition(async () => {
      try {
        const [postData, connectionsData] = await Promise.all([
          getSocialPostAction({ postId }),
          getConnectedPlatformsAction({ accountId }),
        ]);

        const mappedPost = mapPostToState(
          postData as unknown as Record<string, unknown>,
        );
        setPost(mappedPost);

        const linkedInConnections = connectionsData.filter(
          (c) => c.platform === 'linkedin' && c.isActive,
        );
        setConnections(linkedInConnections);

        setSelectedConnectionId(
          mappedPost.platform_connection_id ?? linkedInConnections[0]?.id ?? '',
        );
      } catch {
        toast.error('Failed to load post');
      }
      setIsLoaded(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSelectVariant = useCallback(
    (index: number) => {
      if (!post) return;

      startTransition(async () => {
        try {
          const updated = await updateSocialPostAction({
            postId: post.id,
            selectedVariantIndex: index,
          });
          setPost(
            mapPostToState(updated as unknown as Record<string, unknown>),
          );
        } catch {
          toast.error('Failed to update selection');
        }
      });
    },
    [post],
  );

  const handleEditText = useCallback(
    (text: string) => {
      if (!post) return;
      setPost((prev) => (prev ? { ...prev, final_text: text } : null));

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(() => {
        startTransition(async () => {
          try {
            await updateSocialPostAction({
              postId: post.id,
              finalText: text,
            });
          } catch {
            // Silent fail for debounced saves
          }
        });
      }, 1000);
    },
    [post],
  );

  const handleRegenerate = useCallback(() => {
    if (!post) return;

    startTransition(async () => {
      try {
        await regenerateVariantsAction({ postId: post.id });
        const refreshed = await getSocialPostAction({ postId: post.id });
        setPost(
          mapPostToState(refreshed as unknown as Record<string, unknown>),
        );
        toast.success('New variants generated');
      } catch (error) {
        toast.error('Failed to regenerate', {
          description: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });
  }, [post]);

  const handleApproveAndPublish = useCallback(() => {
    if (!post || !selectedConnectionId) {
      toast.error('Please select a LinkedIn connection first');
      return;
    }

    startTransition(async () => {
      try {
        // Approve first
        await approveSocialPostAction({
          postId: post.id,
          platformConnectionId: selectedConnectionId,
        });

        // Then publish
        const result = await publishSocialPostAction({ postId: post.id });

        if (result.success) {
          toast.success('Published to LinkedIn!', {
            action: result.postUrl
              ? {
                  label: 'View on LinkedIn',
                  onClick: () => window.open(result.postUrl!, '_blank'),
                }
              : undefined,
          });

          const refreshed = await getSocialPostAction({ postId: post.id });
          setPost(
            mapPostToState(refreshed as unknown as Record<string, unknown>),
          );
        }
      } catch (error) {
        toast.error('Failed to publish', {
          description: error instanceof Error ? error.message : 'Unknown error',
        });
        // Refresh to get current state
        const refreshed = await getSocialPostAction({ postId: post.id });
        setPost(
          mapPostToState(refreshed as unknown as Record<string, unknown>),
        );
      }
    });
  }, [post, selectedConnectionId]);

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!post) {
    return (
      <div className="py-20 text-center">
        <p className="text-muted-foreground">Post not found.</p>
      </div>
    );
  }

  const isPublished = post.status === 'published';
  const isPublishing = post.status === 'publishing';

  return (
    <div className="space-y-6">
      {/* Header with back button */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push(`/home/${accountSlug}/social-posts`)}
        >
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Posts
        </Button>

        <div className="flex items-center gap-2">
          {!isPublished && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRegenerate}
              disabled={isPending}
            >
              <RefreshCw
                className={`mr-1 h-4 w-4 ${isPending ? 'animate-spin' : ''}`}
              />
              Regenerate
            </Button>
          )}

          {!isPublished && !isPublishing && (
            <Button
              variant="default"
              size="sm"
              onClick={handleApproveAndPublish}
              disabled={isPending || !post.final_text || !selectedConnectionId}
            >
              {isPending ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-1 h-4 w-4" />
              )}
              Approve & Publish
            </Button>
          )}

          {isPublished && post.platform_url && (
            <Button
              variant="default"
              size="sm"
              onClick={() => window.open(post.platform_url!, '_blank')}
            >
              <ExternalLink className="mr-1 h-4 w-4" />
              View on LinkedIn
            </Button>
          )}
        </div>
      </div>

      {/* Published success banner */}
      {isPublished && (
        <Card className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/30">
          <CardContent className="flex items-center gap-3 py-4">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            <div>
              <p className="font-medium text-green-800 dark:text-green-200">
                Published to LinkedIn
              </p>
              {post.platform_url && (
                <a
                  href={post.platform_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-green-600 underline dark:text-green-400"
                >
                  {post.platform_url}
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* LinkedIn connection selector */}
      {!isPublished && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Linkedin className="h-4 w-4 text-[#0A66C2]" />
              LinkedIn Account
            </CardTitle>
          </CardHeader>
          <CardContent>
            {connections.length > 0 ? (
              <Select
                value={selectedConnectionId}
                onValueChange={setSelectedConnectionId}
                disabled={isPending || isPublished}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select LinkedIn account" />
                </SelectTrigger>
                <SelectContent>
                  {connections.map((conn) => (
                    <SelectItem key={conn.id} value={conn.id}>
                      {conn.platformAccountName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-muted-foreground">
                No LinkedIn accounts connected.{' '}
                <a
                  href={`/home/${accountSlug}/settings`}
                  className="text-primary underline"
                >
                  Connect one in Settings → Platforms
                </a>
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Variant selector */}
      <VariantSelector
        variants={post.generated_variants}
        selectedIndex={post.selected_variant_index}
        onSelect={handleSelectVariant}
        onEditText={handleEditText}
        finalText={post.final_text ?? ''}
        disabled={isPending || isPublished}
      />

      {/* Raw notes reference */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Original Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="max-h-40 overflow-y-auto text-sm whitespace-pre-wrap text-muted-foreground">
            {post.raw_notes}
          </pre>
        </CardContent>
      </Card>
    </div>
  );
}
