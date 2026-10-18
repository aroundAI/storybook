'use client';

import { format } from 'date-fns';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  Clock,
  ExternalLink,
  Eye,
  Heart,
  MessageCircle,
  PauseCircle,
  RefreshCw,
  Trash2,
} from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';

import { PlatformIcon } from './platform-ui';

interface PublishRecord {
  id: string;
  platform: string;
  channelName: string;
  status: string;
  contentType: string;
  platformUrl?: string | null;
  scheduledAt?: string | null;
  publishedAt?: string | null;
  createdAt: string;
  error?: string | null;
  errorCode?: string;
  /** FILM-719: a Short the cadence held back, and the date it missed */
  held?: { reason: string; before: string | null } | null;
  analytics?: {
    /** Null for a Facebook publish: no single view (KB-153). */
    views: number | null;
    likes: number;
    comments: number;
  } | null;
}

interface PublishedContentSectionProps {
  sortedPublishes: PublishRecord[];
  sortOrder: 'asc' | 'desc';
  onToggleSortOrder: () => void;
  loadingPublishes: boolean;
  fetchingPublishes: boolean;
  onRefresh: () => void;
  /** Absent for a caller who may not take videos down (KB-47) */
  onDeleteAll?: () => void;
  onUnpublish?: (
    publishId: string,
    platform: string,
    channelName: string,
  ) => void;
  /** FILM-719: put held Shorts back on their channels' calendars */
  onRequeueHeld?: (publishIds: string[]) => void;
  /** FILM-719: absent for a caller who may not delete publishes */
  onDiscardHeld?: (publishIds: string[]) => void;
}

export function PublishedContentSection({
  sortedPublishes,
  sortOrder,
  onToggleSortOrder,
  loadingPublishes,
  fetchingPublishes,
  onRefresh,
  onDeleteAll,
  onUnpublish,
  onRequeueHeld,
  onDiscardHeld,
}: PublishedContentSectionProps) {
  if (sortedPublishes.length === 0) return null;

  const heldIds = sortedPublishes.filter((p) => p.held).map((p) => p.id);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Check className="h-5 w-5 text-green-500" />
            Published Content
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onToggleSortOrder}
              title={`Sort ${sortOrder === 'asc' ? 'Descending' : 'Ascending'}`}
            >
              {sortOrder === 'asc' ? (
                <ArrowUp className="h-4 w-4" />
              ) : (
                <ArrowDown className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefresh}
              disabled={loadingPublishes || fetchingPublishes}
              title="Refresh"
            >
              <RefreshCw
                className={`h-4 w-4 ${fetchingPublishes ? 'animate-spin' : ''}`}
              />
            </Button>
            {heldIds.length > 1 && onRequeueHeld && (
              <Button
                variant="ghost"
                size="sm"
                data-test="held-requeue-all"
                onClick={() => onRequeueHeld(heldIds)}
              >
                Re-queue {heldIds.length} held
              </Button>
            )}
            {onDeleteAll && (
              <Button
                variant="ghost"
                size="sm"
                className="text-red-500 hover:bg-red-50 hover:text-red-700"
                onClick={onDeleteAll}
                title="Clear All"
                data-test="publish-delete-all"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {sortedPublishes.map((pub) => (
            <div
              key={pub.id}
              className="flex items-center justify-between rounded-lg border bg-card p-3"
              data-test="published-content-item"
              data-publish-id={pub.id}
              data-status={pub.status}
            >
              <div className="flex items-center gap-3">
                <PlatformIcon platform={pub.platform} size="lg" />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">
                      {pub.channelName}
                    </span>
                    <Badge
                      variant="outline"
                      className={
                        pub.status === 'published'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                          : pub.status === 'scheduled'
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400'
                            : pub.status === 'failed'
                              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                              : 'bg-gray-100 text-gray-700'
                      }
                    >
                      {pub.status === 'published' && (
                        <Check className="mr-1 h-3 w-3" />
                      )}
                      {pub.status === 'scheduled' && (
                        <Clock className="mr-1 h-3 w-3" />
                      )}
                      {pub.status === 'failed' && (
                        <AlertCircle className="mr-1 h-3 w-3" />
                      )}
                      {pub.held && <PauseCircle className="mr-1 h-3 w-3" />}
                      {pub.held ? 'held' : pub.status}
                    </Badge>
                    {pub.contentType === 'short' && (
                      <Badge variant="outline" className="text-pink-600">
                        Short
                      </Badge>
                    )}
                  </div>
                  {pub.analytics && (
                    <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <Eye className="h-3 w-3" />
                        {pub.analytics.views === null
                          ? 'Not measured'
                          : pub.analytics.views.toLocaleString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <Heart className="h-3 w-3" />
                        {pub.analytics.likes.toLocaleString()}
                      </span>
                      <span className="flex items-center gap-1">
                        <MessageCircle className="h-3 w-3" />
                        {pub.analytics.comments.toLocaleString()}
                      </span>
                    </div>
                  )}
                  {pub.error && (
                    <p
                      className="mt-1 text-xs text-red-500"
                      data-test="published-content-error"
                      data-error-code={pub.errorCode}
                    >
                      {pub.error}
                    </p>
                  )}
                  {pub.held && (
                    <p
                      className="mt-1 text-xs text-amber-600"
                      data-test="published-content-held"
                    >
                      {pub.held.before
                        ? `Held: it didn't fit before the next episode's long video on ${format(new Date(pub.held.before), 'PP')}`
                        : 'Held: no free slot on this channel'}
                    </p>
                  )}
                  {/* Show scheduled time for scheduled posts */}
                  {pub.status === 'scheduled' && pub.scheduledAt && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      Scheduled for {format(new Date(pub.scheduledAt), 'PPp')}
                    </p>
                  )}
                  {/* Show published time for published posts */}
                  {pub.status === 'published' && pub.publishedAt && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Published {format(new Date(pub.publishedAt), 'PPp')}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {pub.held && onRequeueHeld && (
                  <Button
                    variant="ghost"
                    size="sm"
                    data-test="held-requeue"
                    onClick={() => onRequeueHeld([pub.id])}
                    title="Add to the end of this channel's Shorts queue"
                  >
                    Re-queue
                  </Button>
                )}
                {pub.held && onDiscardHeld && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500"
                    data-test="held-discard"
                    onClick={() => onDiscardHeld([pub.id])}
                  >
                    Discard
                  </Button>
                )}
                {pub.platformUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => window.open(pub.platformUrl ?? '', '_blank')}
                    title="Open on platform"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </Button>
                )}
                {onUnpublish && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:bg-red-50 hover:text-red-700"
                    onClick={() =>
                      onUnpublish(pub.id, pub.platform, pub.channelName)
                    }
                    title="Delete from platform"
                    data-test="publish-unpublish"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
