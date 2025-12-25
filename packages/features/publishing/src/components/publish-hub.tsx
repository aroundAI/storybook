'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';

import { Alert, AlertDescription } from '@kit/ui/alert';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import { toast } from '@kit/ui/sonner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@kit/ui/tabs';

import { getDefaultPlatformSettings } from '../lib/platform-limits';
import type {
  GeneratedClip,
  Platform,
  PlatformConnection,
  PlatformPublishConfig,
  PublishHubProps,
  PublishResult,
} from '../lib/types';
import {
  getConnectedPlatformsAction,
  getPublishStatusAction,
  publishToAllAction,
  retryPublishAction,
} from '../server';
import { MetadataEditor } from './metadata-editor';
import { PlatformSelector } from './platform-selector';
import { PublishStatusRow } from './publish-status-row';
import { ShortsClipper } from './shorts-clipper';

export function PublishHub({
  episodeId,
  projectId: _projectId,
  accountSlug,
  accountId,
  videoUrl,
  thumbnailUrl,
  defaultTitle,
  defaultDescription,
  duration,
}: PublishHubProps) {
  const [activeTab, setActiveTab] = useState<'full' | 'shorts'>('full');
  const [platforms, setPlatforms] = useState<PlatformPublishConfig[]>([]);
  const [publishResults, setPublishResults] = useState<
    Record<string, PublishResult>
  >({});
  const [generatedClips, setGeneratedClips] = useState<GeneratedClip[]>([]);

  // Fetch connected platforms
  const {
    data: connections,
    isLoading: loadingConnections,
    error: connectionsError,
  } = useQuery({
    queryKey: ['platform-connections', accountId],
    queryFn: () => getConnectedPlatformsAction({ accountId }),
    enabled: !!accountId,
  });

  // Initialize platform configs from connections
  useEffect(() => {
    if (connections && Array.isArray(connections)) {
      const configs: PlatformPublishConfig[] = connections.map(
        (conn: PlatformConnection) => ({
          platform: conn.platform,
          connectionId: conn.id,
          enabled: false,
          title: defaultTitle,
          description: defaultDescription,
          tags: [],
          thumbnailUrl,
          platformSpecific: getDefaultPlatformSettings(conn.platform),
          platformAccountName: conn.platformAccountName,
          avatarUrl: conn.avatarUrl,
          followerCount: conn.followerCount,
          tokenValid: conn.tokenValid,
          // Language from connection for multi-language analytics
          language: conn.language || 'en',
        }),
      );
      setPlatforms(configs);
    }
  }, [connections, defaultTitle, defaultDescription, thumbnailUrl]);

  // Publish mutation
  const publishMutation = useMutation({
    mutationFn: async () => {
      const enabledPlatforms = platforms.filter((p) => p.enabled);
      return publishToAllAction({
        episodeId,
        platforms: enabledPlatforms.map((p) => ({
          platform: p.platform,
          connectionId: p.connectionId,
          title: p.title,
          description: p.description,
          tags: p.tags,
          thumbnailUrl: p.thumbnailUrl ?? null,
          scheduledAt: p.scheduledAt?.toISOString() ?? null,
          platformSpecific: p.platformSpecific,
          // Language for multi-language analytics
          language: p.language,
        })),
      });
    },
    onSuccess: (results) => {
      // Update results
      const newResults: Record<string, PublishResult> = {};
      for (const result of results) {
        newResults[result.platform] = result;
      }
      setPublishResults(newResults);

      const successCount = results.filter(
        (r) => r.status === 'completed',
      ).length;
      const failCount = results.filter((r) => r.status === 'failed').length;

      if (failCount === 0) {
        toast.success(`Successfully published to ${successCount} platform(s)`);
      } else if (successCount > 0) {
        toast.warning(
          `Published to ${successCount} platform(s), ${failCount} failed`,
        );
      } else {
        toast.error('All publishes failed');
      }
    },
    onError: (error: Error) => {
      toast.error(`Publishing failed: ${error.message}`);
    },
  });

  // Poll for publish status
  const { data: statusData } = useQuery({
    queryKey: ['publish-status', episodeId],
    queryFn: () => getPublishStatusAction({ episodeId }),
    refetchInterval: () => {
      // Stop polling when all are complete or failed
      const results = Object.values(publishResults);
      if (results.length === 0) return false;
      const allDone = results.every(
        (r) => r.status === 'completed' || r.status === 'failed',
      );
      return allDone ? false : 5000;
    },
    enabled: Object.keys(publishResults).length > 0,
  });

  // Update publish results from polling
  useEffect(() => {
    if (statusData) {
      setPublishResults((prev) => ({
        ...prev,
        ...statusData,
      }));
    }
  }, [statusData]);

  // Retry mutation
  const retryMutation = useMutation({
    mutationFn: (publishId: string) => retryPublishAction({ publishId }),
    onSuccess: (result) => {
      setPublishResults((prev) => ({
        ...prev,
        [result.platform]: result,
      }));
      toast.success(`Retry successful for ${result.platform}`);
    },
    onError: (error: Error) => {
      toast.error(`Retry failed: ${error.message}`);
    },
  });

  const updatePlatformConfig = useCallback(
    (platform: Platform, updates: Partial<PlatformPublishConfig>) => {
      setPlatforms((prev) =>
        prev.map((p) => (p.platform === platform ? { ...p, ...updates } : p)),
      );
    },
    [],
  );

  const handleToggle = useCallback(
    (platform: Platform, enabled: boolean) => {
      updatePlatformConfig(platform, { enabled });
    },
    [updatePlatformConfig],
  );

  const handleConnect = useCallback(
    (platform: Platform) => {
      // Navigate to platform connection page
      window.location.href = `/home/${accountSlug}/settings/platforms?connect=${platform}`;
    },
    [accountSlug],
  );

  const handleClipCreated = useCallback((clip: GeneratedClip) => {
    setGeneratedClips((prev) => [...prev, clip]);
  }, []);

  const handleRetry = useCallback(
    (publishId: string) => {
      retryMutation.mutate(publishId);
    },
    [retryMutation],
  );

  const enabledCount = useMemo(
    () => platforms.filter((p) => p.enabled).length,
    [platforms],
  );
  const isPublishing = publishMutation.isPending;
  const hasResults = Object.keys(publishResults).length > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Publish Hub</h2>
          <p className="text-muted-foreground">
            Publish your video to multiple platforms
          </p>
        </div>
        <Button
          size="lg"
          disabled={enabledCount === 0 || isPublishing}
          onClick={() => publishMutation.mutate()}
        >
          {isPublishing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Publishing...
            </>
          ) : (
            `Publish to ${enabledCount} Platform${enabledCount !== 1 ? 's' : ''}`
          )}
        </Button>
      </div>

      {/* Connection Warning */}
      {!loadingConnections &&
        (!connections ||
          (Array.isArray(connections) && connections.length === 0)) && (
          <Alert>
            <AlertDescription>
              No platforms connected. Go to{' '}
              <a
                href={`/home/${accountSlug}/settings/platforms`}
                className="underline"
              >
                Settings → Platforms
              </a>{' '}
              to connect your accounts.
            </AlertDescription>
          </Alert>
        )}

      {connectionsError && (
        <Alert variant="destructive">
          <AlertDescription>
            Failed to load platform connections. Please try again.
          </AlertDescription>
        </Alert>
      )}

      {/* Content Type Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as 'full' | 'shorts')}
      >
        <TabsList>
          <TabsTrigger value="full">Full Video</TabsTrigger>
          <TabsTrigger value="shorts">Shorts/Clips</TabsTrigger>
        </TabsList>

        <TabsContent value="full" className="space-y-6">
          {/* Platform Selection */}
          <PlatformSelector
            platforms={platforms}
            onToggle={handleToggle}
            onConnect={handleConnect}
          />

          {/* Metadata Editors per Platform */}
          {platforms
            .filter((p) => p.enabled)
            .map((platform) => (
              <MetadataEditor
                key={platform.platform}
                platform={platform}
                onChange={(updates) =>
                  updatePlatformConfig(platform.platform, updates)
                }
                videoPreviewUrl={videoUrl}
              />
            ))}
        </TabsContent>

        <TabsContent value="shorts">
          <ShortsClipper
            videoUrl={videoUrl}
            duration={duration}
            episodeId={episodeId}
            onClipCreated={handleClipCreated}
          />

          {/* Generated Clips */}
          {generatedClips.length > 0 && (
            <Card className="mt-6">
              <CardHeader>
                <CardTitle>Generated Clips ({generatedClips.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {generatedClips.map((clip) => (
                    <div key={clip.id} className="rounded-lg border p-3">
                      <div className="font-medium">{clip.title}</div>
                      <div className="text-muted-foreground text-sm">
                        Duration: {Math.round(clip.duration)}s •{' '}
                        {clip.aspectRatio}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>

      {/* Publish Status */}
      {hasResults && (
        <Card>
          <CardHeader>
            <CardTitle>Publish Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {Object.entries(publishResults).map(([platform, result]) => (
                <PublishStatusRow
                  key={platform}
                  result={result}
                  onRetry={
                    result.status === 'failed' && result.publishId
                      ? () => handleRetry(result.publishId!)
                      : undefined
                  }
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
