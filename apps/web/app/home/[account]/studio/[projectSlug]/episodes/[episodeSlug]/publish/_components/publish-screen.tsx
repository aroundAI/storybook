'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';

import { useQuery } from '@tanstack/react-query';
import { Share2 } from 'lucide-react';

import {
  batchTranslateMetadataAction,
  updatePublishedVideoAction,
  updateShortsGroupsAction,
} from '@kit/episodes/server';
import {
  type EpisodeThumbnail,
  getEpisodeThumbnailsAction,
  uploadEpisodeThumbnailAction,
} from '@kit/episodes/server';
import type { EpisodeWithShots, ShortsGroup } from '@kit/episodes/types';
import { refusalMessage, unwrap } from '@kit/next/action-result';
import {
  type ScheduleConfig,
  ScheduleReleasePanel,
} from '@kit/publishing/components';
// Import shared constants from @kit/publishing
import {
  FULL_VIDEO_PLATFORMS,
  LANG_INFO,
  SHORTS_PLATFORMS,
  type SupportedLanguage,
  parseTags,
} from '@kit/publishing/lib/constants';
import {
  getConnectedPlatformsAction,
  getEpisodePublishesAction,
  publishToAllAction,
  unpublishAction,
} from '@kit/publishing/server';
import {
  PROJECT_ASSETS_BUCKET,
  episodeThumbnailPath,
  fileExtension,
} from '@kit/storage/upload-paths';
import { Button } from '@kit/ui/button';
import { useLlmJob, useLlmWebSocket } from '@kit/ui/hooks';
import { toast } from '@kit/ui/sonner';

import {
  uploadPublishVideo,
  uploadWithPresignedUrl,
} from '~/lib/presigned-upload';

import { DeleteAllDialog } from './delete-all-dialog';
import { EpisodeSummaryGenerator } from './episode-summary-generator';
import { FullVideosSection } from './full-videos-section';
import { MasterAssetManager } from './master-asset-manager';
import { PublishProgressDialog } from './publish-progress-dialog';
import { PublishSettingsSidebar } from './publish-settings-sidebar';
import type {
  DeleteItemStatus,
  DeleteStage,
  PlatformConfig,
  PlatformConnection,
  PlatformUploadStatus,
  PublishStage,
  TranslationResult,
  VideoType,
} from './publish-types';
import { PublishedContentSection } from './published-content-section';
import { ShortsSection } from './shorts-section';
import { UnpublishDialog } from './unpublish-dialog';
import { UploadVideoDialog } from './upload-video-dialog';
import { useYouTubeAudienceGate } from './use-youtube-audience-gate';

interface PublishScreenProps {
  episode: EpisodeWithShots;
  refetchEpisode: () => void;
  accountSlug?: string;
  accountId?: string;
}

export function PublishScreen({
  episode,
  refetchEpisode,
  accountSlug,
  accountId,
}: PublishScreenProps) {
  const [isPending, startTransition] = useTransition();
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadType, setUploadType] = useState<VideoType>('full');
  const [selectedLanguage, setSelectedLanguage] =
    useState<SupportedLanguage>('en');
  const [isUploading, setIsUploading] = useState(false);

  // Publishing progress state
  const [publishStage, setPublishStage] = useState<PublishStage>('idle');
  const [translationResults, setTranslationResults] = useState<
    TranslationResult[]
  >([]);
  const [platformStatuses, setPlatformStatuses] = useState<
    PlatformUploadStatus[]
  >([]);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [pendingPlatformConfigs, setPendingPlatformConfigs] = useState<
    Array<PlatformConfig>
  >([]);

  // Delete progress state
  const [deleteStage, setDeleteStage] = useState<DeleteStage>('idle');
  const [deleteStatuses, setDeleteStatuses] = useState<DeleteItemStatus[]>([]);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [pendingDeletePublish, setPendingDeletePublish] = useState<{
    id: string;
    platform: string;
    channelName: string;
  } | null>(null);

  // Delete all dialog state
  const [deleteAllDialogOpen, setDeleteAllDialogOpen] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  // Scheduling state for schedule release panel
  const [isScheduling, setIsScheduling] = useState(false);

  // Ref for debouncing toast notifications
  const unpublishToastRef = useRef<NodeJS.Timeout | undefined>(undefined);

  // WebSocket subscription for publish/delete updates
  const { subscribe } = useLlmWebSocket();

  // Sorting state for published content (default: asc = lowest to greatest)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Thumbnail upload loading state (per language)
  const [uploadingThumbnails, setUploadingThumbnails] = useState<
    Record<string, boolean>
  >({});

  // Scheduled translations state (for ScheduleReleasePanel)
  const [scheduledTranslations, setScheduledTranslations] = useState<
    Record<string, { title: string; description: string }>
  >({});
  const [isScheduleTranslating, setIsScheduleTranslating] = useState(false);

  // WebSocket for async LLM batch translation results
  const {
    status: llmStatus,
    result: llmResult,
    error: llmError,
  } = useLlmJob<{
    items: Array<{
      id: string;
      translatedTitle: string;
      translatedDescription: string;
      targetLanguage: string;
    }>;
  }>('batch-translate-metadata');

  // Handle batch translation results from WebSocket

  // Handler for ScheduleReleasePanel translation requests - SINGLE batch call
  const handleScheduleTranslate = async (languages: string[]) => {
    setIsScheduleTranslating(true);
    setScheduledTranslations({});

    const baseTitle = metadata.title || episode.title;
    const baseDescription = metadata.description || episode.description || '';

    // Build items for ALL content types and ALL languages in one batch
    const items: Array<{
      id: string;
      contentType: 'full-video' | 'shorts-group';
      title: string;
      description: string;
      targetLanguage: string;
      groupId?: string;
      groupName?: string;
    }> = [];

    // Add Full Video items for each non-English language
    for (const lang of languages) {
      if (lang !== 'en') {
        items.push({
          id: `full-video-${lang}`,
          contentType: 'full-video',
          title: baseTitle,
          description: baseDescription,
          targetLanguage: lang,
        });
      }
    }

    // Add Shorts Group items for each group and each non-English language
    for (const group of shortsGroups) {
      // Get languages that have videos for this group
      const groupLanguages = Object.keys(group.videos).filter(
        (lang) => group.videos[lang] && lang !== 'en',
      );

      for (const lang of groupLanguages) {
        items.push({
          id: `group-${group.id}-${lang}`,
          contentType: 'shorts-group',
          title: group.title || baseTitle,
          description: group.description || baseDescription,
          targetLanguage: lang,
          groupId: group.id,
          groupName: group.title || `Shorts Group`,
        });
      }
    }

    if (items.length > 0) {
      await batchTranslateMetadataAction({ items });
    } else {
      // All English, no translation needed
      setIsScheduleTranslating(false);
    }
    // Results come via WebSocket
  };

  // Metadata state
  const [metadata, setMetadata] = useState({
    title: episode.title || '',
    description: episode.description || '',
    tags: '',
  });

  // Episode thumbnails state (per-language thumbnails)
  const [episodeThumbnails, setEpisodeThumbnails] = useState<
    EpisodeThumbnail[]
  >([]);

  // Fetch episode thumbnails on mount
  useEffect(() => {
    const fetchThumbnails = async () => {
      const result = await getEpisodeThumbnailsAction({
        episodeId: episode.id,
      });
      if (result.success && result.thumbnails) {
        setEpisodeThumbnails(result.thumbnails);
      }
    };
    void fetchThumbnails();
  }, [episode.id]);

  // Get thumbnail URL for a specific language (fallback to default then episode thumbnail)
  const getThumbnailForLanguage = useCallback(
    (lang: string): string | null => {
      const match = episodeThumbnails.find((t) => t.language === lang);
      if (match) return match.thumbnailUrl;
      const defaultThumb = episodeThumbnails.find((t) => t.isDefault);
      if (defaultThumb) return defaultThumb.thumbnailUrl;
      return episode.thumbnailUrl;
    },
    [episodeThumbnails, episode.thumbnailUrl],
  );

  // Handle thumbnail upload for a specific language
  const handleThumbnailUpload = async (lang: string, file: File) => {
    // Validate file size (YouTube limit is 2MB)
    const MAX_THUMBNAIL_SIZE = 2 * 1024 * 1024; // 2MB
    if (file.size > MAX_THUMBNAIL_SIZE) {
      toast.error(
        `Thumbnail must be under 2MB. Your file is ${(file.size / 1024 / 1024).toFixed(1)}MB`,
      );
      return;
    }

    // Set loading state for this language
    setUploadingThumbnails((prev) => ({ ...prev, [lang]: true }));

    try {
      // Upload to R2 via presigned URL
      const uploadResult = await uploadWithPresignedUrl(
        file,
        PROJECT_ASSETS_BUCKET,
        episodeThumbnailPath(episode.id, lang, fileExtension(file.name, 'jpg')),
      );

      // Save to episode_thumbnails table
      const result = await uploadEpisodeThumbnailAction({
        episodeId: episode.id,
        language: lang,
        languageLabel: LANG_INFO[lang as SupportedLanguage]?.name || lang,
        thumbnailUrl: uploadResult.url,
        fileName: file.name,
        fileSizeBytes: file.size,
        mimeType: file.type,
      });

      if (result.success && result.thumbnail) {
        setEpisodeThumbnails((prev) => {
          const filtered = prev.filter((t) => t.language !== lang);
          return [...filtered, result.thumbnail!];
        });
        toast.success(
          `Thumbnail uploaded for ${LANG_INFO[lang as SupportedLanguage]?.name || lang}`,
        );
      } else {
        toast.error(result.error || 'Failed to save thumbnail');
      }
    } catch (error) {
      console.error('Thumbnail upload error:', error);
      toast.error('Failed to upload thumbnail');
    } finally {
      setUploadingThumbnails((prev) => ({ ...prev, [lang]: false }));
    }
  };

  // Shorts groups state - use episode.shortsGroups directly (no legacy migration)
  const [shortsGroups, setShortsGroups] = useState<ShortsGroup[]>(
    episode.shortsGroups ?? [],
  );

  // Currently selected group for upload
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    shortsGroups.length > 0 ? (shortsGroups[0]?.id ?? null) : null,
  );

  // Add new shorts group
  const addShortsGroup = () => {
    const newGroup: ShortsGroup = {
      id: `group-${Date.now()}`,
      name: `Group ${shortsGroups.length + 1}`,
      title: '',
      description: '',
      tags: [],
      videos: {},
    };
    const updatedGroups = [...shortsGroups, newGroup];
    setShortsGroups(updatedGroups);
    setSelectedGroupId(newGroup.id);

    // Persist to database
    startTransition(async () => {
      try {
        await updateShortsGroupsAction({
          episodeId: episode.id,
          shortsGroups: updatedGroups,
        });
      } catch (error) {
        console.error('Failed to save shorts group:', error);
        toast.error('Failed to save group');
      }
    });
  };

  // Update a group's metadata
  const updateGroupMetadata = (
    groupId: string,
    updates: Partial<
      Pick<ShortsGroup, 'title' | 'description' | 'tags' | 'name'>
    >,
  ) => {
    const updatedGroups = shortsGroups.map((g) =>
      g.id === groupId ? { ...g, ...updates } : g,
    );
    setShortsGroups(updatedGroups);

    // Persist to database
    startTransition(async () => {
      try {
        await updateShortsGroupsAction({
          episodeId: episode.id,
          shortsGroups: updatedGroups,
        });
      } catch (error) {
        console.error('Failed to save shorts group:', error);
        toast.error('Failed to save group changes');
      }
    });
  };

  // Delete a group
  const deleteGroup = (groupId: string) => {
    const updatedGroups = shortsGroups.filter((g) => g.id !== groupId);
    setShortsGroups(updatedGroups);
    if (selectedGroupId === groupId) {
      setSelectedGroupId(updatedGroups[0]?.id ?? null);
    }

    // Persist to database
    startTransition(async () => {
      try {
        await updateShortsGroupsAction({
          episodeId: episode.id,
          shortsGroups: updatedGroups,
        });
        toast.success('Group deleted');
      } catch (error) {
        console.error('Failed to delete shorts group:', error);
        toast.error('Failed to delete group');
      }
    });
  };

  // Delete a video from a specific group
  const deleteVideoFromGroup = (groupId: string, language: string) => {
    const updatedGroups = shortsGroups.map((g) => {
      if (g.id === groupId) {
        const updatedVideos = { ...g.videos };
        delete updatedVideos[language];
        return { ...g, videos: updatedVideos };
      }
      return g;
    });
    setShortsGroups(updatedGroups);

    // Persist to database
    startTransition(async () => {
      try {
        await updateShortsGroupsAction({
          episodeId: episode.id,
          shortsGroups: updatedGroups,
        });
        toast.success(
          `Removed ${LANG_INFO[language as SupportedLanguage]?.name || language} video`,
        );
      } catch (error) {
        console.error('Failed to delete video from group:', error);
        toast.error('Failed to delete video');
      }
    });
  };

  // Fetch connected platforms
  const {
    data: connections,
    isLoading: loadingConnections,
    refetch: refetchConnections,
  } = useQuery({
    queryKey: ['platform-connections', accountId],
    queryFn: () =>
      accountId
        ? getConnectedPlatformsAction({ accountId })
        : Promise.resolve([]),
    enabled: !!accountId,
  });

  // KB-30: YouTube uploads declare an audience the creator chose, never a default.
  const audienceGate = useYouTubeAudienceGate(() => void refetchConnections());

  // What each YouTube channel in the pending publish will declare, read from
  // the configs that will actually be sent — shown on the confirm step.
  const youtubeDeclarations = pendingPlatformConfigs
    .filter(
      (config, index, all) =>
        config.platform === 'youtube' &&
        all.findIndex((c) => c.connectionId === config.connectionId) === index,
    )
    .map((config) => ({
      connectionId: config.connectionId,
      channelName:
        (connections ?? []).find((c) => c.id === config.connectionId)
          ?.platformAccountName ?? 'YouTube',
      madeForKids: config.platformSpecific.madeForKids,
      categoryId: config.platformSpecific.categoryId,
    }));

  // Handle batch translation results from WebSocket
  useEffect(() => {
    const isPublishTranslating = publishStage === 'translating';

    if (
      llmStatus === 'success' &&
      llmResult &&
      (isScheduleTranslating || isPublishTranslating)
    ) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resultData = (llmResult as any)?.data || llmResult;
      const items = resultData?.items || [];

      if (items.length > 0) {
        // Store translations keyed by item ID (e.g., 'full-video-hi', 'group-123-hi')
        const newTranslations: Record<
          string,
          {
            title: string;
            description: string;
            contentType?: string;
            language: string;
          }
        > = {};

        // Also build array for buildPlatformConfigs if needed
        const translationResults: TranslationResult[] = [];

        for (const item of items) {
          const trans = {
            title: item.translatedTitle,
            description: item.translatedDescription,
            contentType: item.id.startsWith('full-video-')
              ? 'full-video'
              : 'shorts-group',
            language: item.targetLanguage,
          };

          newTranslations[item.id] = trans;

          if (isPublishTranslating) {
            translationResults.push({
              id: item.id,
              contentType: trans.contentType as 'full-video' | 'shorts-group',
              contentName: item.contentName || 'Content',
              language: item.targetLanguage,
              title: item.translatedTitle,
              description: item.translatedDescription,
              status: 'success',
              groupId: item.groupId,
            });
          }
        }

        setScheduledTranslations((prev) => ({ ...prev, ...newTranslations }));
        toast.success(
          `Translated ${items.length} item${items.length > 1 ? 's' : ''}`,
        );

        // If this was the "Publish Now" flow, proceed to confirmation
        if (isPublishTranslating) {
          const baseTitle = metadata.title || episode.title;
          const baseDescription =
            metadata.description || episode.description || '';
          const conns = (connections ?? []) as PlatformConnection[];

          buildPlatformConfigsAndConfirm(
            translationResults,
            conns,
            baseTitle,
            baseDescription,
          );
        }
      }

      setIsScheduleTranslating(false);
    } else if (
      llmStatus === 'error' &&
      (isScheduleTranslating || isPublishTranslating)
    ) {
      toast.error(llmError || 'Translation failed');
      setIsScheduleTranslating(false);
      if (isPublishTranslating) {
        setPublishError(llmError || 'Translation failed');
        setPublishStage('error');
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- buildPlatformConfigsAndConfirm receives all reactive data via params; adding it would require useCallback on a 100+ line fn
  }, [
    llmStatus,
    llmResult,
    llmError,
    isScheduleTranslating,
    publishStage,
    metadata,
    episode,
    connections,
  ]);

  // Fetch published content
  const {
    data: publishes,
    isLoading: loadingPublishes,
    isFetching: fetchingPublishes,
    refetch: refetchPublishes,
  } = useQuery({
    queryKey: ['episode-publishes', episode.id],
    queryFn: () => getEpisodePublishesAction({ episodeId: episode.id }),
  });

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const unsubscribe = subscribe('publish-status', (msg: any) => {
      // Handle delete events
      if (
        msg.type === 'delete-success' ||
        msg.type === 'delete-error' ||
        msg.type === 'delete-warning'
      ) {
        setDeleteStatuses((prev) =>
          prev.map((s) => {
            if (s.publishId === msg.publishId) {
              if (msg.type === 'delete-success') {
                return { ...s, status: 'success' };
              }
              if (msg.type === 'delete-error') {
                return { ...s, status: 'error', error: msg.error };
              }
              if (msg.type === 'delete-warning') {
                return {
                  ...s,
                  status: 'error', // Show as error/warning in UI
                  error: msg.message,
                };
              }
            }
            return s;
          }),
        );

        if (msg.type === 'delete-success') {
          // Debounce the success toast to avoid duplicates for multi-platform/batch deletes
          if (unpublishToastRef.current) {
            clearTimeout(unpublishToastRef.current);
          }
          unpublishToastRef.current = setTimeout(() => {
            toast.success('Unpublish complete');
            refetchPublishes();
            unpublishToastRef.current = undefined;
          }, 500);
        } else if (msg.type === 'delete-error') {
          toast.error(`Unpublish failed: ${msg.error}`);
        } else if (msg.type === 'delete-warning') {
          toast.warning(`Unpublish warning: ${msg.message}`);
        }
      }

      // Handle publish events
      if (msg.type === 'publish-success' || msg.type === 'publish-error') {
        const platform = msg.platform;
        setPlatformStatuses((prev) =>
          prev.map((s) => {
            if (s.platform === platform) {
              if (msg.type === 'publish-success') {
                return { ...s, status: 'success', url: msg.url };
              }
              if (msg.type === 'publish-error') {
                return { ...s, status: 'error', error: msg.error };
              }
            }
            return s;
          }),
        );
      }
    });

    return unsubscribe;
  }, [subscribe, refetchPublishes]);

  // Sort publishes by scheduled/published time
  const sortedPublishes = useMemo(() => {
    if (!publishes) return [];
    return [...publishes].sort((a, b) => {
      const getTime = (p: typeof a) => {
        if (p.status === 'scheduled' && p.scheduledAt)
          return new Date(p.scheduledAt).getTime();
        if (p.status === 'published' && p.publishedAt)
          return new Date(p.publishedAt).getTime();
        return new Date(p.createdAt).getTime();
      };
      const timeA = getTime(a);
      const timeB = getTime(b);
      return sortOrder === 'asc' ? timeA - timeB : timeB - timeA;
    });
  }, [publishes, sortOrder]);

  // Group connections by platform type (full video vs shorts)
  const { fullVideoChannels, shortsChannels: _shortsChannels } = useMemo(() => {
    const conns = (connections ?? []) as PlatformConnection[];
    return {
      fullVideoChannels: conns.filter((c) =>
        ['youtube', 'facebook'].includes(c.platform),
      ),
      shortsChannels: conns.filter((c) =>
        ['youtube', 'instagram', 'facebook', 'tiktok'].includes(c.platform),
      ),
    };
  }, [connections]);

  // Group by language
  const channelsByLanguage = useMemo(() => {
    const conns = (connections ?? []) as PlatformConnection[];
    const grouped: Record<string, PlatformConnection[]> = {};
    for (const conn of conns) {
      const lang = conn.language || 'en';
      if (!grouped[lang]) grouped[lang] = [];
      grouped[lang].push(conn);
    }
    return grouped;
  }, [connections]);

  // Get current videos (full videos only - shorts use groups)
  const localizedVideos = (episode.localizedVideos ?? {}) as Record<
    string,
    string
  >;

  const uploadedFullLanguages = Object.keys(localizedVideos).filter(
    (lang) => localizedVideos[lang],
  ) as SupportedLanguage[];

  // Get available languages for full videos
  const getAvailableLanguages = () => {
    return (Object.keys(LANG_INFO) as SupportedLanguage[]).filter(
      (lang) => !uploadedFullLanguages.includes(lang),
    );
  };

  // Get available languages for a specific shorts group
  const getAvailableLanguagesForGroup = (groupId: string) => {
    const group = shortsGroups.find((g) => g.id === groupId);
    const usedLanguages = group
      ? Object.keys(group.videos).filter((k) => group.videos[k])
      : [];
    return (Object.keys(LANG_INFO) as SupportedLanguage[]).filter(
      (lang) => !usedLanguages.includes(lang),
    );
  };

  const handleOpenUploadDialog = (type: VideoType, groupId?: string) => {
    setUploadType(type);

    if (type === 'shorts' && groupId) {
      setSelectedGroupId(groupId);
      const available = getAvailableLanguagesForGroup(groupId);
      if (available.length > 0) {
        setSelectedLanguage(available[0] ?? 'en');
      }
    } else {
      const available = getAvailableLanguages();
      if (available.length > 0) {
        setSelectedLanguage(available[0] ?? 'en');
      }
    }

    setUploadDialogOpen(true);
  };

  const handleUpload = async (file: File) => {
    setIsUploading(true);

    try {
      // Use presigned URL upload to bypass Lambda 6MB limit
      const result = await uploadPublishVideo(
        file,
        episode.id,
        selectedLanguage,
      );

      startTransition(async () => {
        try {
          if (uploadType === 'full') {
            // Update full video
            const updateResult = await updatePublishedVideoAction({
              episodeId: episode.id,
              language: selectedLanguage,
              videoUrl: result.url,
            });
            if (updateResult.success) {
              toast.success(
                `Video uploaded for ${LANG_INFO[selectedLanguage].name}`,
              );
              setUploadDialogOpen(false);
              refetchEpisode();
            }
          } else {
            // Update shorts group - add video to selected group
            if (!selectedGroupId) {
              toast.error('Please select a group first');
              return;
            }
            const updatedGroups = shortsGroups.map((g) =>
              g.id === selectedGroupId
                ? {
                    ...g,
                    videos: { ...g.videos, [selectedLanguage]: result.url },
                  }
                : g,
            );
            const updateResult = await updateShortsGroupsAction({
              episodeId: episode.id,
              shortsGroups: updatedGroups,
            });
            if (updateResult.success) {
              setShortsGroups(updatedGroups);
              toast.success(
                `Short uploaded for ${LANG_INFO[selectedLanguage].name}`,
              );
              setUploadDialogOpen(false);
            }
          }
        } catch (error) {
          console.error('Failed to update:', error);
          toast.error('Failed to update video');
        }
      });
    } catch (error) {
      console.error('Upload error:', error);
      toast.error(refusalMessage(error, 'Upload failed'));
    } finally {
      setIsUploading(false);
    }
  };

  // Remove a full video (shorts use deleteVideoFromGroup instead)
  const handleRemoveVideo = (lang: SupportedLanguage) => {
    startTransition(async () => {
      try {
        const result = await updatePublishedVideoAction({
          episodeId: episode.id,
          language: lang,
          videoUrl: '',
        });

        if (result.success) {
          toast.success(`Removed ${LANG_INFO[lang].name} video`);
          refetchEpisode();
        }
      } catch (error) {
        console.error('Failed to remove video:', error);
        toast.error('Failed to remove video');
      }
    });
  };

  // Handle scheduled release - applies staggered scheduledAt times
  const handleScheduleRelease = async (config: ScheduleConfig) => {
    const conns = (connections ?? []) as PlatformConnection[];

    if (conns.length === 0) {
      toast.error('No connected channels. Connect platforms first.');
      return;
    }

    const scheduledLanguages = new Set<string>(
      config.schedule.map((item) => item.language),
    );
    const declared = await audienceGate.ensureDeclared(
      conns.filter((c) => scheduledLanguages.has(c.language || 'en')),
    );
    if (!declared) return;

    setIsScheduling(true);

    // Build platform configs with scheduled times
    const platformConfigs: Array<PlatformConfig & { scheduledAt: string }> = [];

    const baseTitle = metadata.title || episode.title;
    const baseDescription = metadata.description || episode.description || '';
    const baseTags = parseTags(metadata.tags);

    // Process each scheduled item
    for (const item of config.schedule) {
      const channelsForLang = conns.filter(
        (c) => (c.language || 'en') === item.language,
      );

      // Use translated title/description from schedule item, fallback to base
      const itemTitle = item.title || baseTitle;
      const itemDescription = item.description || baseDescription;

      if (item.type === 'full') {
        // Full video channels (using constant)
        const fullChannels = channelsForLang.filter((c) =>
          FULL_VIDEO_PLATFORMS.includes(
            c.platform as (typeof FULL_VIDEO_PLATFORMS)[number],
          ),
        );
        for (const channel of fullChannels) {
          platformConfigs.push({
            platform: channel.platform,
            connectionId: channel.id,
            contentType: 'full',
            title: itemTitle,
            description: itemDescription,
            tags: baseTags,
            thumbnailUrl: getThumbnailForLanguage(item.language),
            language: item.language,
            scheduledAt: item.scheduledAt.toISOString(),
            platformSpecific: audienceGate.platformSpecificFor(channel),
          });
        }
      } else {
        // Shorts channels (using constant)
        const group = shortsGroups.find((g) => g.id === item.groupId);
        const shortsChannels = channelsForLang.filter((c) =>
          SHORTS_PLATFORMS.includes(
            c.platform as (typeof SHORTS_PLATFORMS)[number],
          ),
        );
        for (const channel of shortsChannels) {
          platformConfigs.push({
            platform: channel.platform,
            connectionId: channel.id,
            contentType: 'short',
            // Pass shorts group ID so cron can resolve the correct video
            shortsGroupId: item.groupId,
            // itemTitle/itemDescription already contain translated values from ScheduleReleasePanel
            // with proper fallback chain: translation -> group metadata -> base metadata
            title: itemTitle,
            description: itemDescription,
            tags: group?.tags?.length ? group.tags : baseTags,
            // Shorts don't use custom thumbnails - platforms generate from video
            thumbnailUrl: undefined,
            language: item.language,
            scheduledAt: item.scheduledAt.toISOString(),
            platformSpecific: audienceGate.platformSpecificFor(
              channel,
              channel.platform === 'facebook' ? { isReel: true } : {},
            ),
          });
        }
      }
    }

    if (platformConfigs.length === 0) {
      toast.error(
        'No matching channels for uploaded videos. Check language settings.',
      );
      setIsScheduling(false);
      return;
    }

    // Call publish with all configs (they have scheduledAt set)
    try {
      await unwrap(
        publishToAllAction({
          episodeId: episode.id,
          platforms: platformConfigs,
        }),
      );
      toast.success(`Scheduled ${platformConfigs.length} uploads`);
      refetchPublishes();
    } catch (error) {
      // Use generic error message for security (avoid exposing server details)
      console.error('Scheduling failed:', error);
      toast.error('Failed to schedule uploads. Please try again.');
    } finally {
      setIsScheduling(false);
    }
  };

  // Stage 1: Start publishing - collect items and trigger batch translation
  const handlePublish = async () => {
    const conns = (connections ?? []) as PlatformConnection[];

    if (conns.length === 0) {
      toast.error('No connected channels. Connect platforms first.');
      return;
    }

    const publishLanguages = new Set<string>([
      ...uploadedFullLanguages,
      ...shortsGroups.flatMap((group) =>
        Object.keys(group.videos).filter((lang) => group.videos[lang]),
      ),
    ]);
    const declared = await audienceGate.ensureDeclared(
      conns.filter((c) => publishLanguages.has(c.language || 'en')),
    );
    if (!declared) return;

    // Reset state
    setPublishError(null);
    setPublishStage('translating');

    const baseTitle = metadata.title || episode.title;
    const baseDescription = metadata.description || episode.description || '';

    // Build list of all content items to translate
    // Each item is unique: full-video per language + each shorts group per language
    const translationItems: TranslationResult[] = [];
    const batchItems: Array<{
      id: string;
      contentType: 'full-video' | 'shorts-group';
      title: string;
      description: string;
      targetLanguage: string;
      groupId?: string;
      groupName?: string;
    }> = [];

    // Add full video translations for each non-English language
    for (const lang of uploadedFullLanguages) {
      const itemId = `full-video-${lang}`;
      translationItems.push({
        id: itemId,
        contentType: 'full-video',
        contentName: 'Full Video',
        language: lang,
        title: lang === 'en' ? baseTitle : '',
        description: lang === 'en' ? baseDescription : '',
        status: lang === 'en' ? 'success' : 'translating',
      });

      if (lang !== 'en') {
        batchItems.push({
          id: itemId,
          contentType: 'full-video',
          title: baseTitle,
          description: baseDescription,
          targetLanguage: lang,
        });
      }
    }

    // Add shorts group translations for each group + language
    for (const group of shortsGroups) {
      const groupLangs = Object.keys(group.videos).filter(
        (lang) => group.videos[lang],
      ) as SupportedLanguage[];

      const groupTitle = group.title || baseTitle;
      const groupDescription = group.description || baseDescription;

      for (const lang of groupLangs) {
        const itemId = `group-${group.id}-${lang}`;
        translationItems.push({
          id: itemId,
          contentType: 'shorts-group',
          contentName: group.name || 'Shorts Group',
          language: lang,
          title: lang === 'en' ? groupTitle : '',
          description: lang === 'en' ? groupDescription : '',
          status: lang === 'en' ? 'success' : 'translating',
          groupId: group.id,
        });

        if (lang !== 'en') {
          batchItems.push({
            id: itemId,
            contentType: 'shorts-group',
            title: groupTitle,
            description: groupDescription,
            targetLanguage: lang,
            groupId: group.id,
            groupName: group.name || 'Shorts Group',
          });
        }
      }
    }

    // Set initial translation state (shows all items in UI)
    setTranslationResults(translationItems);

    // If no items need translation (all English), skip to confirmation
    if (batchItems.length === 0) {
      // Build platform configs directly
      await buildPlatformConfigsAndConfirm(
        translationItems,
        conns,
        baseTitle,
        baseDescription,
      );
      return;
    }

    // Queue batch translation job - results come via WebSocket
    try {
      await batchTranslateMetadataAction({ items: batchItems });
      // The useEffect for batchLlmStatus will handle the result and call buildPlatformConfigs
    } catch (error) {
      console.error('Batch translation failed:', error);
      setPublishError('Failed to start translation. Please try again.');
      setPublishStage('error');
    }
  };

  // Helper: Build platform configs after translations are complete
  const buildPlatformConfigsAndConfirm = async (
    translations: TranslationResult[],
    conns: PlatformConnection[],
    baseTitle: string,
    baseDescription: string,
  ) => {
    const platformConfigs: PlatformConfig[] = [];

    // Build a lookup map for translations
    const translationMap = new Map(
      translations.map((t) => [
        t.id,
        {
          title: t.title || baseTitle,
          description: t.description || baseDescription,
        },
      ]),
    );

    // Process Full Videos -> YouTube, Facebook
    for (const lang of uploadedFullLanguages) {
      const channelsForLang = conns.filter(
        (c) =>
          (c.language || 'en') === lang &&
          ['youtube', 'facebook'].includes(c.platform),
      );

      const fullVideoId = `full-video-${lang}`;
      const langMeta = translationMap.get(fullVideoId) || {
        title: baseTitle,
        description: baseDescription,
      };

      for (const channel of channelsForLang) {
        platformConfigs.push({
          platform: channel.platform,
          connectionId: channel.id,
          contentType: 'full',
          title: langMeta.title,
          description: langMeta.description,
          tags: metadata.tags
            ? metadata.tags
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean)
            : [],
          thumbnailUrl: getThumbnailForLanguage(lang as SupportedLanguage),
          language: lang,
          platformSpecific: audienceGate.platformSpecificFor(channel),
        });
      }
    }

    // Process Shorts Groups -> YouTube Shorts, Instagram Reels, Facebook Reels, TikTok
    for (const group of shortsGroups) {
      const groupLangs = Object.keys(group.videos).filter(
        (lang) => group.videos[lang],
      ) as SupportedLanguage[];

      for (const lang of groupLangs) {
        const channelsForLang = conns.filter(
          (c) =>
            (c.language || 'en') === lang &&
            ['youtube', 'instagram', 'facebook', 'tiktok'].includes(c.platform),
        );

        const groupId = `group-${group.id}-${lang}`;
        const groupMeta = translationMap.get(groupId) || {
          title: group.title || baseTitle,
          description: group.description || baseDescription,
        };

        for (const channel of channelsForLang) {
          platformConfigs.push({
            platform: channel.platform,
            connectionId: channel.id,
            contentType: 'short',
            shortsGroupId: group.id, // Identify which group's video to use
            title: groupMeta.title,
            description: groupMeta.description,
            tags:
              group.tags.length > 0
                ? group.tags
                : metadata.tags
                  ? metadata.tags
                      .split(',')
                      .map((t) => t.trim())
                      .filter(Boolean)
                  : [],
            thumbnailUrl: getThumbnailForLanguage(lang),
            language: lang,
            platformSpecific: audienceGate.platformSpecificFor(
              channel,
              channel.platform === 'facebook' ? { isReel: true } : {},
            ),
          });
        }
      }
    }

    if (platformConfigs.length === 0) {
      setPublishError(
        'No matching channels for uploaded videos. Check language settings.',
      );
      setPublishStage('error');
      return;
    }

    // Store configs and show confirmation
    setPendingPlatformConfigs(platformConfigs);
    setPublishStage('confirm-translation');
  };

  // Stage 2: Confirm and upload to platforms - with sequential progress updates
  const confirmAndUpload = async () => {
    setPublishStage('uploading');
    const conns = (connections ?? []) as PlatformConnection[];

    // Initialize all platform statuses as pending
    const initialStatuses: PlatformUploadStatus[] = pendingPlatformConfigs.map(
      (config) => {
        const conn = conns.find((c) => c.id === config.connectionId);
        return {
          platform: config.platform,
          connectionName: conn?.platformAccountName || config.platform,
          language: config.language,
          contentType: config.contentType,
          status: 'pending' as const,
        };
      },
    );
    setPlatformStatuses(initialStatuses);

    let successCount = 0;
    let failureCount = 0;

    // Upload each platform sequentially for real-time progress
    for (let i = 0; i < pendingPlatformConfigs.length; i++) {
      const config = pendingPlatformConfigs[i]!;

      // Set current platform to 'uploading'
      setPlatformStatuses((prev) =>
        prev.map((s, idx) =>
          idx === i ? { ...s, status: 'uploading' as const } : s,
        ),
      );

      try {
        // Upload single platform
        const results = await unwrap(
          publishToAllAction({
            episodeId: episode.id,
            platforms: [config],
          }),
        );

        const result = results[0] as
          | { status: string; url?: string; error?: string }
          | undefined;

        // API returns 'completed' for success, 'failed' for failure
        if (result?.status === 'completed') {
          successCount++;
          setPlatformStatuses((prev) =>
            prev.map((s, idx) =>
              idx === i
                ? { ...s, status: 'success' as const, url: result.url }
                : s,
            ),
          );
        } else {
          failureCount++;
          setPlatformStatuses((prev) =>
            prev.map((s, idx) =>
              idx === i
                ? {
                    ...s,
                    status: 'error' as const,
                    error: result?.error || 'Unknown error',
                  }
                : s,
            ),
          );
        }
      } catch (error) {
        failureCount++;
        const errorMessage = refusalMessage(error, 'Upload failed');
        setPlatformStatuses((prev) =>
          prev.map((s, idx) =>
            idx === i
              ? { ...s, status: 'error' as const, error: errorMessage }
              : s,
          ),
        );
      }
    }

    // Final state - show complete if any succeeded, or partial success message
    if (failureCount === 0) {
      setPublishStage('complete');
    } else if (successCount > 0) {
      // Partial success - still show complete but with warning info in statuses
      setPublishStage('complete');
    } else {
      // All failed
      setPublishError(
        `All ${pendingPlatformConfigs.length} platform(s) failed to publish.`,
      );
      setPublishStage('error');
    }

    refetchPublishes();
  };

  // Cancel publishing
  const cancelPublish = () => {
    setPublishStage('idle');
    setTranslationResults([]);
    setPlatformStatuses([]);
    setPublishError(null);
    setPendingPlatformConfigs([]);
  };

  // Initiate unpublish - show confirmation dialog
  const initiateUnpublish = (
    publishId: string,
    platform: string,
    channelName: string,
  ) => {
    setPendingDeletePublish({ id: publishId, platform, channelName });
    setDeleteError(null);
    setDeleteStatuses([
      {
        publishId,
        platform,
        channelName,
        status: 'pending',
        note: ['instagram', 'tiktok'].includes(platform)
          ? 'Will be removed from records only - manual deletion required on platform'
          : undefined,
      },
    ]);
    setDeleteStage('confirm');
  };

  // Execute unpublish with progress tracking
  const confirmUnpublish = async () => {
    if (!pendingDeletePublish) return;

    setDeleteStage('deleting');
    setDeleteStatuses((prev) =>
      prev.map((s) => ({ ...s, status: 'deleting' as const })),
    );

    try {
      toast.info('Deletion started...');
      await unwrap(unpublishAction({ publishId: pendingDeletePublish.id }));

      // Close dialog immediately for background processing
      cancelDelete();
      refetchPublishes();
    } catch (error) {
      const errorMessage = refusalMessage(error, 'Failed to unpublish');
      setDeleteStatuses((prev) =>
        prev.map((s) => ({
          ...s,
          status: 'error' as const,
          error: errorMessage,
        })),
      );
      setDeleteError(errorMessage);
      setDeleteStage('error');
    }
  };

  // Cancel delete
  const cancelDelete = () => {
    setDeleteStage('idle');
    setDeleteStatuses([]);
    setDeleteError(null);
    setPendingDeletePublish(null);
  };

  return (
    <>
      {/* Publishing Progress Modal */}
      {audienceGate.dialog}

      <PublishProgressDialog
        publishStage={publishStage}
        youtubeDeclarations={youtubeDeclarations}
        translationResults={translationResults}
        platformStatuses={platformStatuses}
        publishError={publishError}
        onCancel={cancelPublish}
        onConfirmUpload={confirmAndUpload}
      />

      {/* Delete Progress Modal */}
      <UnpublishDialog
        deleteStage={deleteStage}
        deleteStatuses={deleteStatuses}
        deleteError={deleteError}
        onCancel={cancelDelete}
        onConfirm={confirmUnpublish}
      />

      {/* Delete All Confirmation Dialog */}
      <DeleteAllDialog
        open={deleteAllDialogOpen}
        onOpenChange={setDeleteAllDialogOpen}
        episodeId={episode.id}
        isDeletingAll={isDeletingAll}
        setIsDeletingAll={setIsDeletingAll}
        onDeleted={() => refetchPublishes()}
      />

      <div className="flex h-full flex-col overflow-auto bg-gray-50/50 p-6 dark:bg-gray-900/50">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Publishing Studio
            </h1>
            <p className="text-gray-500 dark:text-gray-400">
              Upload videos by language, then publish to connected channels.
            </p>
          </div>
          <Button
            onClick={handlePublish}
            data-test="publish-all"
            disabled={
              uploadedFullLanguages.length === 0 && shortsGroups.length === 0
            }
            className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white"
          >
            <Share2 className="mr-2 h-4 w-4" />
            Publish All
          </Button>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left: Video Uploads */}
          <div className="space-y-6 lg:col-span-2">
            {/* Master Assets Record Keeping */}
            <MasterAssetManager
              projectId={episode.projectId}
              episodeId={episode.id}
              masterVideoAsset={episode.masterVideoAsset}
              titleCards={episode.titleCards}
              version={episode.version}
              onUpdate={refetchEpisode}
            />

            {/* Canon Summary Generator */}
            <EpisodeSummaryGenerator
              projectId={episode.projectId}
              episodeId={episode.id}
              episodeNumber={episode.number}
              season={episode.season?.number}
              storyContent={episode.storyData?.fullStory || ''}
            />

            {/* Full Videos Section */}
            <FullVideosSection
              uploadedFullLanguages={uploadedFullLanguages}
              localizedVideos={localizedVideos}
              channelsByLanguage={channelsByLanguage}
              fullVideoChannels={fullVideoChannels}
              isPending={isPending}
              uploadingThumbnails={uploadingThumbnails}
              getThumbnailForLanguage={getThumbnailForLanguage}
              getAvailableLanguages={getAvailableLanguages}
              onOpenUploadDialog={handleOpenUploadDialog}
              onRemoveVideo={handleRemoveVideo}
              onThumbnailUpload={handleThumbnailUpload}
            />

            {/* Shorts Section - Grouped */}
            <ShortsSection
              shortsGroups={shortsGroups}
              onAddGroup={addShortsGroup}
              onUpdateGroupMetadata={updateGroupMetadata}
              onDeleteGroup={deleteGroup}
              onDeleteVideoFromGroup={deleteVideoFromGroup}
              onOpenUploadDialog={handleOpenUploadDialog}
            />

            {/* Published Content Section */}
            <PublishedContentSection
              sortedPublishes={sortedPublishes}
              sortOrder={sortOrder}
              onToggleSortOrder={() =>
                setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
              }
              loadingPublishes={loadingPublishes}
              fetchingPublishes={fetchingPublishes}
              onRefresh={() => refetchPublishes()}
              onDeleteAll={() => setDeleteAllDialogOpen(true)}
              onUnpublish={initiateUnpublish}
            />
          </div>

          {/* Right: Settings & Connected Channels */}
          <div className="space-y-6">
            <PublishSettingsSidebar
              metadata={metadata}
              onMetadataChange={setMetadata}
              channelsByLanguage={channelsByLanguage}
              loadingConnections={loadingConnections}
              connectionsCount={connections?.length ?? 0}
              accountSlug={accountSlug}
              onRefreshConnections={() => refetchConnections()}
            >
              {/* Schedule Release - rendered between Settings and Channels */}
              <ScheduleReleasePanel
                fullVideoLanguages={uploadedFullLanguages}
                shortsGroups={shortsGroups.map((g) => ({
                  id: g.id,
                  name: g.name || `Group ${shortsGroups.indexOf(g) + 1}`,
                  title: g.title,
                  description: g.description,
                  videoLanguages: Object.keys(g.videos).filter(
                    (lang) => g.videos[lang],
                  ),
                }))}
                baseMetadata={{
                  title: metadata.title || episode.title,
                  description:
                    metadata.description || episode.description || '',
                }}
                onSchedule={handleScheduleRelease}
                onPublishNow={handlePublish}
                onTranslate={handleScheduleTranslate}
                translatedMetadata={scheduledTranslations}
                isTranslating={isScheduleTranslating}
                isPublishing={
                  publishStage === 'uploading' || publishStage === 'translating'
                }
                isScheduling={isScheduling}
              />
            </PublishSettingsSidebar>
          </div>
        </div>
      </div>

      {/* Upload Dialog */}
      <UploadVideoDialog
        open={uploadDialogOpen}
        onOpenChange={setUploadDialogOpen}
        uploadType={uploadType}
        selectedLanguage={selectedLanguage}
        onLanguageChange={setSelectedLanguage}
        availableLanguages={
          uploadType === 'full'
            ? getAvailableLanguages()
            : getAvailableLanguagesForGroup(selectedGroupId ?? '')
        }
        channelsForLanguage={channelsByLanguage[selectedLanguage] ?? []}
        accountSlug={accountSlug}
        isUploading={isUploading}
        isPending={isPending}
        onUpload={handleUpload}
      />
    </>
  );
}
