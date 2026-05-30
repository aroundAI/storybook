'use client';

import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  Linkedin,
  Loader2,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent } from '@kit/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@kit/ui/dropdown-menu';

interface SocialPost {
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
}

interface PostsListProps {
  posts: SocialPost[];
  onView: (postId: string) => void;
  onPublish: (postId: string) => void;
  onDelete: (postId: string) => void;
  onRegenerate: (postId: string) => void;
  publishingIds?: Set<string>;
}

const STATUS_CONFIG: Record<
  string,
  {
    label: string;
    variant: 'default' | 'secondary' | 'destructive' | 'outline';
    icon: React.ReactNode;
  }
> = {
  draft: {
    label: 'Draft',
    variant: 'secondary',
    icon: <FileText className="h-3 w-3" />,
  },
  ready_to_review: {
    label: 'Ready to Review',
    variant: 'outline',
    icon: <Clock className="h-3 w-3" />,
  },
  approved: {
    label: 'Approved',
    variant: 'default',
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  publishing: {
    label: 'Publishing...',
    variant: 'default',
    icon: <Loader2 className="h-3 w-3 animate-spin" />,
  },
  published: {
    label: 'Published',
    variant: 'default',
    icon: <CheckCircle2 className="h-3 w-3" />,
  },
  failed: {
    label: 'Failed',
    variant: 'destructive',
    icon: <XCircle className="h-3 w-3" />,
  },
};

function getStatusConfig(status: string) {
  return (
    STATUS_CONFIG[status] ?? {
      label: status,
      variant: 'secondary' as const,
      icon: <AlertCircle className="h-3 w-3" />,
    }
  );
}

function formatRelativeTime(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function PostsList({
  posts,
  onView,
  onPublish,
  onDelete,
  onRegenerate,
  publishingIds = new Set(),
}: PostsListProps) {
  if (posts.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Linkedin className="text-muted-foreground mx-auto mb-4 h-12 w-12 opacity-20" />
          <h3 className="mb-1 text-lg font-semibold">No posts yet</h3>
          <p className="text-muted-foreground text-sm">
            Create your first LinkedIn post by pasting your notes above.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {posts.map((post) => {
        const statusConfig = getStatusConfig(post.status);
        const isPublishing = publishingIds.has(post.id);
        const text = post.final_text || post.raw_notes;
        const previewText = text.substring(0, 200);

        return (
          <Card
            key={post.id}
            className="group cursor-pointer transition-shadow hover:shadow-md"
            onClick={() => onView(post.id)}
          >
            <CardContent className="py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  {/* Status + timestamp */}
                  <div className="mb-2 flex items-center gap-2">
                    <Badge
                      variant={statusConfig.variant}
                      className="flex items-center gap-1"
                    >
                      {statusConfig.icon}
                      {statusConfig.label}
                    </Badge>
                    <span className="text-muted-foreground text-xs">
                      {formatRelativeTime(post.created_at)}
                    </span>
                    {post.generated_variants.length > 0 && (
                      <Badge variant="outline" className="text-xs">
                        {post.generated_variants.length} variants
                      </Badge>
                    )}
                  </div>

                  {/* Preview text */}
                  <p className="line-clamp-3 text-sm leading-relaxed">
                    {previewText}
                    {text.length > 200 && '...'}
                  </p>

                  {/* Hashtags */}
                  {post.hashtags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {post.hashtags.slice(0, 5).map((tag) => (
                        <Badge
                          key={tag}
                          variant="secondary"
                          className="text-xs"
                        >
                          #{tag}
                        </Badge>
                      ))}
                      {post.hashtags.length > 5 && (
                        <Badge variant="secondary" className="text-xs">
                          +{post.hashtags.length - 5}
                        </Badge>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div
                  className="flex items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  {post.status === 'ready_to_review' && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => onView(post.id)}
                    >
                      <Pencil className="mr-1 h-3 w-3" />
                      Review
                    </Button>
                  )}

                  {post.status === 'approved' && (
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => onPublish(post.id)}
                      disabled={isPublishing}
                    >
                      {isPublishing ? (
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                      ) : (
                        <Send className="mr-1 h-3 w-3" />
                      )}
                      Publish
                    </Button>
                  )}

                  {post.status === 'published' && post.platform_url && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(post.platform_url!, '_blank')}
                    >
                      <ExternalLink className="mr-1 h-3 w-3" />
                      View
                    </Button>
                  )}

                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onView(post.id)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        View / Edit
                      </DropdownMenuItem>
                      {post.status !== 'published' && (
                        <DropdownMenuItem onClick={() => onRegenerate(post.id)}>
                          <RefreshCw className="mr-2 h-4 w-4" />
                          Regenerate
                        </DropdownMenuItem>
                      )}
                      {post.status === 'published' && post.platform_url && (
                        <DropdownMenuItem
                          onClick={() =>
                            window.open(post.platform_url!, '_blank')
                          }
                        >
                          <ExternalLink className="mr-2 h-4 w-4" />
                          View on LinkedIn
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSeparator />
                      {post.status !== 'published' && (
                        <DropdownMenuItem
                          className="text-red-600"
                          onClick={() => onDelete(post.id)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
