'use client';

import type { ReactNode } from 'react';

import { Loader2, RefreshCw } from 'lucide-react';

import type { SupportedLanguage } from '@kit/publishing/lib/constants';
import { LANG_INFO } from '@kit/publishing/lib/constants';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { Textarea } from '@kit/ui/textarea';

import { ChannelBadge } from './platform-ui';
import type { PlatformConnection } from './publish-types';

interface PublishSettingsSidebarProps {
  metadata: {
    title: string;
    description: string;
    tags: string;
  };
  onMetadataChange: (metadata: {
    title: string;
    description: string;
    tags: string;
  }) => void;
  channelsByLanguage: Record<string, PlatformConnection[]>;
  loadingConnections: boolean;
  connectionsCount: number;
  accountSlug?: string;
  onRefreshConnections: () => void;
  children?: ReactNode;
}

export function PublishSettingsSidebar({
  metadata,
  onMetadataChange,
  channelsByLanguage,
  loadingConnections,
  connectionsCount,
  accountSlug,
  onRefreshConnections,
  children,
}: PublishSettingsSidebarProps) {
  return (
    <>
      {/* Publish Settings */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Publish Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={metadata.title}
              onChange={(e) =>
                onMetadataChange({ ...metadata, title: e.target.value })
              }
              placeholder="Episode title"
            />
          </div>
          <div>
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={metadata.description}
              onChange={(e) =>
                onMetadataChange({ ...metadata, description: e.target.value })
              }
              placeholder="Episode description"
              rows={4}
            />
          </div>
          <div>
            <Label htmlFor="tags">Tags</Label>
            <Input
              id="tags"
              value={metadata.tags}
              onChange={(e) =>
                onMetadataChange({ ...metadata, tags: e.target.value })
              }
              placeholder="episode, series, topic"
            />
            <p className="mt-1 text-xs text-gray-500">Comma-separated</p>
          </div>
        </CardContent>
      </Card>

      {children}

      {/* Connected Channels */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Connected Channels</CardTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={onRefreshConnections}
              disabled={loadingConnections}
            >
              <RefreshCw
                className={`h-4 w-4 ${loadingConnections ? 'animate-spin' : ''}`}
              />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loadingConnections ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
            </div>
          ) : connectionsCount === 0 ? (
            <div className="py-6 text-center">
              <p className="mb-3 text-sm text-gray-500">
                No channels connected
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  (window.location.href = `/home/${accountSlug}/settings/platforms`)
                }
              >
                Connect Channels
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {Object.entries(channelsByLanguage).map(([lang, channels]) => (
                <div key={lang}>
                  <div className="mb-2 flex items-center gap-2">
                    <span>
                      {LANG_INFO[lang as SupportedLanguage]?.flag ?? '🌐'}
                    </span>
                    <span className="text-sm font-medium">
                      {LANG_INFO[lang as SupportedLanguage]?.name ??
                        lang.toUpperCase()}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {channels.map((conn) => (
                      <ChannelBadge key={conn.id} conn={conn} size="md" />
                    ))}
                  </div>
                </div>
              ))}
              <UndeclaredYouTubeNote
                channels={Object.values(channelsByLanguage).flat()}
              />
              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() =>
                  (window.location.href = `/home/${accountSlug}/settings/platforms`)
                }
              >
                Manage Channels
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

/**
 * KB-30: a YouTube channel with no declared audience is asked about on the
 * next publish; say so here, before the question appears.
 */
function UndeclaredYouTubeNote({
  channels,
}: {
  channels: PlatformConnection[];
}) {
  const undeclared = channels.filter(
    (channel) =>
      channel.platform === 'youtube' &&
      (typeof channel.youtubeMadeForKids !== 'boolean' ||
        !channel.youtubeCategoryId),
  );

  if (undeclared.length === 0) return null;

  return (
    <p
      className="text-xs text-amber-700 dark:text-amber-400"
      data-test="youtube-audience-not-set"
    >
      Audience not set for{' '}
      {undeclared.map((channel) => channel.platformAccountName).join(', ')}.
      You&apos;ll be asked who it&apos;s for when you publish.
    </p>
  );
}
