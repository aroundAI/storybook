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
import { format } from 'date-fns';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Clock,
  ExternalLink,
  Eye,
  Facebook,
  Film,
  Heart,
  Instagram,
  Loader2,
  MessageCircle,
  Plus,
  RefreshCw,
  Share2,
  Smartphone,
  Trash2,
  Upload,
  Video,
  X,
  Youtube,
} from 'lucide-react';
import { useDropzone } from 'react-dropzone';

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
  deleteEpisodePublishesAction,
  getConnectedPlatformsAction,
  getEpisodePublishesAction,
  publishToAllAction,
  unpublishAction,
} from '@kit/publishing/server';
import { Avatar, AvatarFallback, AvatarImage } from '@kit/ui/avatar';
import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { useLlmJob, useLlmWebSocket } from '@kit/ui/hooks';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@kit/ui/tooltip';

import {
  uploadPublishVideo,
  uploadWithPresignedUrl,
} from '~/lib/presigned-upload';

interface PublishScreenProps {
  episode: EpisodeWithShots;
  refetchEpisode: () => void;
  accountSlug?: string;
  accountId?: string;
}

// Platform icons and configurations - with light/dark mode compatible colors
const PLATFORM_CONFIG: Record<
  string,
  { name: string; bgColor: string; textColor: string; shortName: string }
> = {
  youtube: {
    name: 'YouTube',
    bgColor: 'bg-red-500 dark:bg-red-600',
    textColor: 'text-white',
    shortName: 'YT',
  },
  facebook: {
    name: 'Facebook',
    bgColor: 'bg-blue-600 dark:bg-blue-700',
    textColor: 'text-white',
    shortName: 'FB',
  },
  instagram: {
    name: 'Instagram',
    bgColor: 'bg-gradient-to-br from-purple-600 via-pink-500 to-orange-400',
    textColor: 'text-white',
    shortName: 'IG',
  },
  tiktok: {
    name: 'TikTok',
    bgColor: 'bg-gray-900 dark:bg-gray-800',
    textColor: 'text-white',
    shortName: 'TT',
  },
};

// Platform icon component - uses lucide-react SVG icons with colored badges
const PlatformIcon = ({
  platform,
  size = 'md',
}: {
  platform: string;
  size?: 'sm' | 'md' | 'lg';
}) => {
  const config = PLATFORM_CONFIG[platform];
  const sizeClasses = {
    sm: 'h-5 w-5',
    md: 'h-7 w-7',
    lg: 'h-8 w-8',
  };
  const iconSizeClasses = {
    sm: 'h-2.5 w-2.5',
    md: 'h-3.5 w-3.5',
    lg: 'h-4 w-4',
  };

  const IconComponent = () => {
    const iconClass = iconSizeClasses[size];
    switch (platform) {
      case 'youtube':
        return <Youtube className={iconClass} />;
      case 'facebook':
        return <Facebook className={iconClass} />;
      case 'instagram':
        return <Instagram className={iconClass} />;
      case 'tiktok':
        // Lucide doesn't have TikTok icon, use text fallback
        return <span className="text-[9px] font-bold">TT</span>;
      default:
        return (
          <span className="text-[9px] font-bold">
            {platform.slice(0, 2).toUpperCase()}
          </span>
        );
    }
  };

  return (
    <div
      className={`flex items-center justify-center rounded-lg ${sizeClasses[size]} ${config?.bgColor || 'bg-gray-500'} ${config?.textColor || 'text-white'}`}
    >
      <IconComponent />
    </div>
  );
};

type VideoType = 'full' | 'shorts';
type Platform = 'youtube' | 'facebook' | 'instagram' | 'tiktok';

// Publishing progress types
type PublishStage =
  | 'idle'
  | 'translating'
  | 'confirm-translation'
  | 'uploading'
  | 'complete'
  | 'error';

type TranslationResult = {
  id: string; // Unique ID: 'full-video-hi' or 'group-xxx-hi'
  contentType: 'full-video' | 'shorts-group';
  contentName: string; // Display name: 'Full Video' or group name
  language: string;
  title: string;
  description: string;
  status: 'pending' | 'translating' | 'success' | 'error';
  error?: string;
  groupId?: string; // For shorts groups
};

type PlatformUploadStatus = {
  platform: string;
  connectionName: string;
  language: string;
  contentType: 'full' | 'short';
  status: 'pending' | 'uploading' | 'success' | 'error';
  url?: string;
  error?: string;
};

// Delete progress types
type DeleteStage = 'idle' | 'confirm' | 'deleting' | 'complete' | 'error';

type DeleteItemStatus = {
  publishId: string;
  platform: string;
  channelName: string;
  status: 'pending' | 'deleting' | 'success' | 'error' | 'skipped';
  error?: string;
  note?: string; // For platform limitations like Instagram
};

export interface PlatformConnection {
  id: string;
  platform: Platform;
  platformAccountName: string;
  avatarUrl: string | null;
  tokenValid: boolean;
  language: string;
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

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
    Array<{
      platform: Platform;
      connectionId: string;
      contentType: 'full' | 'short';
      title: string;
      description: string;
      tags: string[];
      thumbnailUrl?: string | null;
      language: string;
      shortsGroupId?: string;
      platformSpecific: Record<string, unknown>;
    }>
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
      const ext = file.name.split('.').pop() || 'jpg';
      const timestamp = Date.now();
      const path = `episodes/${episode.id}/thumbnails/${lang}-${timestamp}.${ext}`;
      const uploadResult = await uploadWithPresignedUrl(
        file,
        'project-assets',
        path,
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

  // Handle batch translation results from WebSocket
  useEffect(() => {
    const isPublishTranslating = publishStage === 'translating';

    if (llmStatus === 'success' && llmResult && (isScheduleTranslating || isPublishTranslating)) {
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
              groupId: item.groupId
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
          const baseDescription = metadata.description || episode.description || '';
          const conns = (connections ?? []) as PlatformConnection[];

          buildPlatformConfigsAndConfirm(
            translationResults,
            conns,
            baseTitle,
            baseDescription
          );
        }
      }

      setIsScheduleTranslating(false);
    } else if (llmStatus === 'error' && (isScheduleTranslating || isPublishTranslating)) {
      toast.error(llmError || 'Translation failed');
      setIsScheduleTranslating(false);
      if (isPublishTranslating) {
        setPublishError(llmError || 'Translation failed');
        setPublishStage('error');
      }
    }
  }, [llmStatus, llmResult, llmError, isScheduleTranslating, publishStage, metadata, episode, connections]);

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

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const file = acceptedFiles[0];
    if (file) {
      setSelectedFile(file);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'video/mp4': ['.mp4'],
      'video/quicktime': ['.mov'],
      'video/webm': ['.webm'],
    },
    maxFiles: 1,
    maxSize: 500 * 1024 * 1024,
  });

  const handleOpenUploadDialog = (type: VideoType, groupId?: string) => {
    setUploadType(type);
    setSelectedFile(null);

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

  const handleUpload = async () => {
    if (!selectedFile) return;
    setIsUploading(true);

    try {
      // Use presigned URL upload to bypass Lambda 6MB limit
      const result = await uploadPublishVideo(
        selectedFile,
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
              setSelectedFile(null);
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
              setSelectedFile(null);
            }
          }
        } catch (error) {
          console.error('Failed to update:', error);
          toast.error('Failed to update video');
        }
      });
    } catch (error) {
      console.error('Upload error:', error);
      toast.error(error instanceof Error ? error.message : 'Upload failed');
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

    setIsScheduling(true);

    // Build platform configs with scheduled times
    const platformConfigs: Array<{
      platform: Platform;
      connectionId: string;
      contentType: 'full' | 'short';
      shortsGroupId?: string; // For shorts - identifies which shorts group
      title: string;
      description: string;
      tags: string[];
      thumbnailUrl?: string | null;
      language: string;
      scheduledAt: string;
      platformSpecific: Record<string, unknown>;
    }> = [];

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
            platformSpecific: {},
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
            // For shorts, prefer group title, then translated, then base
            title: group?.title || itemTitle,
            description: group?.description || itemDescription,
            tags: group?.tags?.length ? group.tags : baseTags,
            thumbnailUrl: getThumbnailForLanguage(item.language),
            language: item.language,
            scheduledAt: item.scheduledAt.toISOString(),
            platformSpecific:
              channel.platform === 'facebook' ? { isReel: true } : {},
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
      await publishToAllAction({
        episodeId: episode.id,
        platforms: platformConfigs,
      });
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
    const platformConfigs: typeof pendingPlatformConfigs = [];

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
          platformSpecific: {},
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
            platformSpecific:
              channel.platform === 'facebook' ? { isReel: true } : {},
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
        const results = await publishToAllAction({
          episodeId: episode.id,
          platforms: [config],
        });

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
        const errorMessage =
          error instanceof Error ? error.message : 'Upload failed';
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
      await unpublishAction({ publishId: pendingDeletePublish.id });

      // Close dialog immediately for background processing
      cancelDelete();
      refetchPublishes();
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to unpublish';
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

  // Channel badge component
  const ChannelBadge = ({
    conn,
    size = 'sm',
  }: {
    conn: PlatformConnection;
    size?: 'sm' | 'md';
  }) => {
    const config = PLATFORM_CONFIG[conn.platform];
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div
              className={`flex items-center gap-1.5 rounded-full border px-2 py-1 ${size === 'md' ? 'px-3 py-1.5' : ''} ${conn.tokenValid ? 'bg-card border-gray-200' : 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'}`}
            >
              <Avatar className={size === 'md' ? 'h-5 w-5' : 'h-4 w-4'}>
                <AvatarImage src={conn.avatarUrl ?? undefined} />
                <AvatarFallback
                  className={`${config?.bgColor} text-[10px] text-white`}
                >
                  {config?.shortName}
                </AvatarFallback>
              </Avatar>
              <span
                className={`font-medium ${size === 'md' ? 'text-sm' : 'text-xs'}`}
              >
                {conn.platformAccountName}
              </span>
              {!conn.tokenValid && (
                <AlertCircle className="h-3 w-3 text-red-500" />
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent>
            <p>
              {config?.name}: {conn.platformAccountName}
            </p>
            {!conn.tokenValid && (
              <p className="text-red-400">Token expired - needs reconnection</p>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  };

  // Video card with channel destinations and thumbnail upload
  const VideoCard = ({
    type,
    lang,
    videoUrl,
    channels,
  }: {
    type: VideoType;
    lang: SupportedLanguage;
    videoUrl: string;
    channels: PlatformConnection[];
  }) => {
    const relevantChannels =
      type === 'full'
        ? channels.filter((c) => ['youtube', 'facebook'].includes(c.platform))
        : channels.filter((c) =>
          ['youtube', 'instagram', 'facebook', 'tiktok'].includes(c.platform),
        );

    const thumbnailUrl = getThumbnailForLanguage(lang);
    const thumbnailInputId = `thumbnail-input-${type}-${lang}`;

    return (
      <div className="group relative overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="aspect-video w-full bg-black">
          <video
            src={videoUrl}
            controls
            className="h-full w-full object-contain"
          />
        </div>
        <div className="p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-lg">{LANG_INFO[lang]?.flag}</span>
              <span className="text-sm font-medium">
                {LANG_INFO[lang]?.name}
              </span>
              <Check className="h-4 w-4 text-green-500" />
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleRemoveVideo(lang)}
              disabled={isPending}
              className="text-red-500 opacity-0 transition-opacity group-hover:opacity-100"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          {/* Thumbnail Preview and Upload */}
          <div className="mb-2 flex items-center gap-2">
            <div className="relative h-10 w-16 flex-shrink-0 overflow-hidden rounded border border-gray-200 dark:border-gray-600">
              {/* Upload spinner overlay */}
              {uploadingThumbnails[lang] && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50">
                  <Loader2 className="h-4 w-4 animate-spin text-white" />
                </div>
              )}
              {thumbnailUrl ? (
                <img
                  src={thumbnailUrl}
                  alt={`${LANG_INFO[lang]?.name} thumbnail`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gray-100 dark:bg-gray-700">
                  <Film className="h-4 w-4 text-gray-400" />
                </div>
              )}
            </div>
            <input
              type="file"
              id={thumbnailInputId}
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleThumbnailUpload(lang, file);
              }}
            />
            <label
              htmlFor={thumbnailInputId}
              className="flex cursor-pointer items-center gap-1 rounded bg-gray-100 px-2 py-1 text-xs text-gray-600 transition-colors hover:bg-indigo-100 hover:text-indigo-600 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-indigo-900 dark:hover:text-indigo-400"
            >
              <Upload className="h-3 w-3" />
              {thumbnailUrl ? 'Change' : 'Add'} Thumbnail
            </label>
          </div>

          {/* Destination channels */}
          {relevantChannels.length > 0 ? (
            <div className="flex flex-wrap gap-1">
              {relevantChannels.map((conn) => (
                <ChannelBadge key={conn.id} conn={conn} />
              ))}
            </div>
          ) : (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              No channels connected for {LANG_INFO[lang].name}
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Publishing Progress Modal */}
      <Dialog
        open={publishStage !== 'idle'}
        onOpenChange={(open) => !open && cancelPublish()}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {publishStage === 'translating' && (
                <>
                  <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
                  Translating Metadata...
                </>
              )}
              {publishStage === 'confirm-translation' && (
                <>
                  <Check className="h-5 w-5 text-green-500" />
                  Confirm Translations
                </>
              )}
              {publishStage === 'uploading' && (
                <>
                  <Upload className="h-5 w-5 animate-pulse text-indigo-500" />
                  Publishing to Platforms...
                </>
              )}
              {publishStage === 'complete' && (
                <>
                  <Check className="h-5 w-5 text-green-500" />
                  Publishing Complete!
                </>
              )}
              {publishStage === 'error' && (
                <>
                  <AlertCircle className="h-5 w-5 text-red-500" />
                  Publishing Failed
                </>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Translation Stage */}
            {(publishStage === 'translating' ||
              publishStage === 'confirm-translation') && (
                <div className="space-y-3">
                  <p className="text-sm text-gray-500">
                    {publishStage === 'translating'
                      ? 'Translating titles and descriptions for each language...'
                      : 'Review the translated metadata before publishing:'}
                  </p>
                  <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                    {translationResults.map((t) => (
                      <div
                        key={t.id}
                        className="flex items-start gap-3 rounded-md bg-gray-50 p-2 dark:bg-gray-800"
                      >
                        <span className="text-xl">
                          {LANG_INFO[t.language as SupportedLanguage]?.flag ||
                            '🌐'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium">
                              {t.contentName}
                            </span>
                            <Badge variant="outline" className="text-[10px]">
                              {LANG_INFO[t.language as SupportedLanguage]?.name ||
                                t.language}
                            </Badge>
                            {t.contentType === 'shorts-group' && (
                              <Badge variant="secondary" className="text-[10px]">
                                <Smartphone className="mr-0.5 h-2.5 w-2.5" />
                                Short
                              </Badge>
                            )}
                            {t.status === 'pending' && (
                              <span className="text-xs text-gray-400">
                                Pending
                              </span>
                            )}
                            {t.status === 'translating' && (
                              <Loader2 className="h-3 w-3 animate-spin text-indigo-500" />
                            )}
                            {t.status === 'success' && (
                              <Check className="h-3 w-3 text-green-500" />
                            )}
                            {t.status === 'error' && (
                              <X className="h-3 w-3 text-red-500" />
                            )}
                          </div>
                          {t.status === 'success' && t.title && (
                            <p className="mt-0.5 truncate text-xs text-gray-600 dark:text-gray-400">
                              {t.title}
                            </p>
                          )}
                          {t.error && (
                            <p className="mt-0.5 text-xs text-red-500">
                              {t.error}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

            {/* Uploading Stage */}
            {(publishStage === 'uploading' || publishStage === 'complete') && (
              <div className="space-y-3">
                <p className="text-sm text-gray-500">
                  {publishStage === 'uploading'
                    ? 'Uploading videos to each platform...'
                    : 'All uploads completed:'}
                </p>
                <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                  {platformStatuses.map((s, i) => (
                    <div
                      key={i}
                      className="flex items-center gap-3 rounded-md bg-gray-50 p-2 dark:bg-gray-800"
                    >
                      <PlatformIcon platform={s.platform} size="lg" />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {s.connectionName}
                          </span>
                          <Badge variant="outline" className="text-[10px]">
                            {s.contentType === 'short' ? 'Short' : 'Full'}
                          </Badge>
                          <span className="text-xs">
                            {LANG_INFO[s.language as SupportedLanguage]?.flag}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {s.status === 'pending' && (
                          <Clock className="h-4 w-4 text-gray-400" />
                        )}
                        {s.status === 'uploading' && (
                          <Loader2 className="h-4 w-4 animate-spin text-indigo-500" />
                        )}
                        {s.status === 'success' && (
                          <>
                            <Check className="h-4 w-4 text-green-500" />
                            {s.url && (
                              <a
                                href={s.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-indigo-500 hover:text-indigo-600"
                              >
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </>
                        )}
                        {s.status === 'error' && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger>
                                <X className="h-4 w-4 text-red-500" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="max-w-xs">{s.error}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Error Stage */}
            {publishStage === 'error' && publishError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
                <p className="text-sm text-red-700 dark:text-red-400">
                  {publishError}
                </p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end gap-2 pt-2">
              {publishStage === 'confirm-translation' && (
                <>
                  <Button variant="outline" onClick={cancelPublish}>
                    Cancel
                  </Button>
                  <Button
                    onClick={confirmAndUpload}
                    className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white"
                  >
                    <Upload className="mr-2 h-4 w-4" />
                    Confirm & Publish
                  </Button>
                </>
              )}
              {(publishStage === 'complete' || publishStage === 'error') && (
                <Button onClick={cancelPublish}>
                  {publishStage === 'complete' ? 'Done' : 'Close'}
                </Button>
              )}
              {(publishStage === 'translating' ||
                publishStage === 'uploading') && (
                  <Button variant="outline" disabled>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Please wait...
                  </Button>
                )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Progress Modal */}
      <Dialog
        open={deleteStage !== 'idle'}
        onOpenChange={(open) => !open && cancelDelete()}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {deleteStage === 'confirm' && (
                <>
                  <Trash2 className="h-5 w-5 text-red-500" />
                  Confirm Unpublish
                </>
              )}
              {deleteStage === 'deleting' && (
                <>
                  <Loader2 className="h-5 w-5 animate-spin text-red-500" />
                  Unpublishing...
                </>
              )}
              {deleteStage === 'complete' && (
                <>
                  <Check className="h-5 w-5 text-green-500" />
                  Unpublished
                </>
              )}
              {deleteStage === 'error' && (
                <>
                  <AlertCircle className="h-5 w-5 text-red-500" />
                  Unpublish Failed
                </>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Item Status */}
            <div className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
              {deleteStatuses.map((s) => (
                <div
                  key={s.publishId}
                  className="flex items-center gap-3 rounded-md bg-gray-50 p-2 dark:bg-gray-800"
                >
                  <PlatformIcon platform={s.platform} size="lg" />
                  <div className="min-w-0 flex-1">
                    <span className="text-sm font-medium">{s.channelName}</span>
                    {s.note && (
                      <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                        ⚠️ {s.note}
                      </p>
                    )}
                    {s.error && (
                      <p className="mt-0.5 text-xs text-red-500">{s.error}</p>
                    )}
                  </div>
                  <div>
                    {s.status === 'pending' && (
                      <Clock className="h-4 w-4 text-gray-400" />
                    )}
                    {s.status === 'deleting' && (
                      <Loader2 className="h-4 w-4 animate-spin text-red-500" />
                    )}
                    {s.status === 'success' && (
                      <Check className="h-4 w-4 text-green-500" />
                    )}
                    {s.status === 'error' && (
                      <X className="h-4 w-4 text-red-500" />
                    )}
                    {s.status === 'skipped' && (
                      <span className="text-xs text-gray-400">Skipped</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {deleteStage === 'confirm' && (
              <p className="text-sm text-gray-500">
                This will delete the content from the platform and remove it
                from your records.
              </p>
            )}

            {deleteStage === 'error' && deleteError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
                <p className="text-sm text-red-700 dark:text-red-400">
                  {deleteError}
                </p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end gap-2 pt-2">
              {deleteStage === 'confirm' && (
                <>
                  <Button variant="outline" onClick={cancelDelete}>
                    Cancel
                  </Button>
                  <Button onClick={confirmUnpublish} variant="destructive">
                    <Trash2 className="mr-2 h-4 w-4" />
                    Unpublish
                  </Button>
                </>
              )}
              {(deleteStage === 'complete' || deleteStage === 'error') && (
                <Button onClick={cancelDelete}>
                  {deleteStage === 'complete' ? 'Done' : 'Close'}
                </Button>
              )}
              {deleteStage === 'deleting' && (
                <Button variant="outline" disabled>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Please wait...
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete All Confirmation Dialog */}
      <Dialog
        open={deleteAllDialogOpen}
        onOpenChange={(open) => !isDeletingAll && setDeleteAllDialogOpen(open)}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-red-500" />
              Delete All Publish Records
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">
              This will permanently delete all publish records for this episode.
              This action cannot be undone.
            </p>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-500">
              Note: This only removes records from our system. Videos already
              published to platforms will need to be deleted manually.
            </p>
          </div>
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => setDeleteAllDialogOpen(false)}
              disabled={isDeletingAll}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={isDeletingAll}
              onClick={async () => {
                setIsDeletingAll(true);
                try {
                  const result = await deleteEpisodePublishesAction({
                    episodeId: episode.id,
                  });
                  toast.success(
                    `Deleted ${result.deletedCount} publish record(s)`,
                  );
                  refetchPublishes();
                  setDeleteAllDialogOpen(false);
                } catch {
                  toast.error('Failed to delete publish records');
                } finally {
                  setIsDeletingAll(false);
                }
              }}
            >
              {isDeletingAll ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                <>
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete All
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
            {/* Full Videos Section */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Film className="h-5 w-5 text-indigo-500" />
                    Full Videos
                  </CardTitle>
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <ChevronRight className="h-4 w-4" />
                    {fullVideoChannels.length > 0 ? (
                      <div className="flex -space-x-1">
                        {fullVideoChannels.slice(0, 3).map((c) => (
                          <Avatar
                            key={c.id}
                            className="h-5 w-5 border-2 border-white dark:border-gray-800"
                          >
                            <AvatarImage src={c.avatarUrl ?? undefined} />
                            <AvatarFallback
                              className={`${PLATFORM_CONFIG[c.platform]?.bgColor} text-[8px] text-white`}
                            >
                              {PLATFORM_CONFIG[c.platform]?.shortName}
                            </AvatarFallback>
                          </Avatar>
                        ))}
                        {fullVideoChannels.length > 3 && (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-200 text-[9px] font-medium dark:bg-gray-700">
                            +{fullVideoChannels.length - 3}
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-amber-600">No channels</span>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {uploadedFullLanguages.length === 0 ? (
                  <button
                    onClick={() => handleOpenUploadDialog('full')}
                    className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 p-8 text-gray-500 transition-colors hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-600 dark:border-gray-600 dark:bg-gray-800/50"
                  >
                    <Upload className="h-8 w-8" />
                    <span className="font-medium">
                      Upload Full Video (16:9)
                    </span>
                  </button>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {uploadedFullLanguages.map((lang) => (
                      <VideoCard
                        key={lang}
                        type="full"
                        lang={lang}
                        videoUrl={localizedVideos[lang] ?? ''}
                        channels={channelsByLanguage[lang] ?? []}
                      />
                    ))}
                    {getAvailableLanguages().length > 0 && (
                      <button
                        onClick={() => handleOpenUploadDialog('full')}
                        className="flex aspect-video w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 text-gray-500 transition-colors hover:border-indigo-400 hover:bg-indigo-50 hover:text-indigo-600 dark:border-gray-600 dark:bg-gray-800/50 dark:hover:border-indigo-500 dark:hover:bg-gray-700/50 dark:hover:text-indigo-400"
                      >
                        <Plus className="h-6 w-6" />
                        <span className="text-sm font-medium">
                          Add Language
                        </span>
                      </button>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Shorts Section - Grouped */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Smartphone className="h-5 w-5 text-pink-500" />
                    Shorts / Reels
                    <Badge variant="outline" className="ml-2 text-xs">
                      {shortsGroups.length} group
                      {shortsGroups.length !== 1 ? 's' : ''}
                    </Badge>
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={addShortsGroup}
                      className="border-pink-300 text-pink-600 hover:bg-pink-50"
                    >
                      <Plus className="mr-1 h-4 w-4" />
                      New Group
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {shortsGroups.length === 0 ? (
                  <button
                    onClick={addShortsGroup}
                    className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 p-8 text-gray-500 transition-colors hover:border-pink-400 hover:bg-pink-50 hover:text-pink-600 dark:border-gray-600 dark:bg-gray-800/50"
                  >
                    <Upload className="h-8 w-8" />
                    <span className="font-medium">
                      Create First Shorts Group
                    </span>
                    <span className="text-sm text-gray-400">
                      Each group has its own metadata that gets translated
                    </span>
                  </button>
                ) : (
                  shortsGroups.map((group, groupIndex) => (
                    <div
                      key={group.id}
                      className="border-border overflow-hidden rounded-lg border"
                    >
                      {/* Group Header */}
                      <div className="border-border border-b bg-gradient-to-r from-pink-50 to-purple-50 p-3 dark:from-pink-900/20 dark:to-purple-900/20">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-semibold text-pink-600 dark:text-pink-400">
                              Group {groupIndex + 1}
                            </span>
                            <Input
                              value={group.name}
                              onChange={(e) =>
                                updateGroupMetadata(group.id, {
                                  name: e.target.value,
                                })
                              }
                              className="h-7 w-32 border-pink-200 text-xs"
                              placeholder="Group name"
                            />
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => deleteGroup(group.id)}
                            className="h-7 w-7 p-0 text-red-500 hover:bg-red-50 hover:text-red-700"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      {/* Group Metadata */}
                      <div className="space-y-2 bg-gray-50/50 p-3 dark:bg-gray-800/30">
                        <div>
                          <label className="text-xs font-medium text-gray-500">
                            Title
                          </label>
                          <Input
                            value={group.title}
                            onChange={(e) =>
                              updateGroupMetadata(group.id, {
                                title: e.target.value,
                              })
                            }
                            className="h-8 text-sm"
                            placeholder="Title for this shorts group"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-medium text-gray-500">
                            Description
                          </label>
                          <textarea
                            value={group.description}
                            onChange={(e) =>
                              updateGroupMetadata(group.id, {
                                description: e.target.value,
                              })
                            }
                            className="border-border bg-card min-h-[60px] w-full rounded-md border p-2 text-sm"
                            placeholder="Description for this group (will be translated per language)"
                          />
                        </div>
                      </div>

                      {/* Group Videos */}
                      <div className="p-3">
                        <div className="grid gap-3 sm:grid-cols-2">
                          {Object.entries(group.videos).map(
                            ([lang, url]) =>
                              url && (
                                <div
                                  key={lang}
                                  className="border-border group/video relative overflow-hidden rounded-lg border"
                                >
                                  <video
                                    src={url}
                                    className="aspect-[9/16] w-full bg-black object-cover"
                                    controls
                                  />
                                  <div className="absolute bottom-2 left-2 flex items-center gap-1 rounded bg-black/70 px-2 py-1 text-xs text-white">
                                    <span>
                                      {
                                        LANG_INFO[lang as SupportedLanguage]
                                          ?.flag
                                      }
                                    </span>
                                    <span>
                                      {
                                        LANG_INFO[lang as SupportedLanguage]
                                          ?.name
                                      }
                                    </span>
                                  </div>
                                  {/* Delete video button */}
                                  <button
                                    onClick={() =>
                                      deleteVideoFromGroup(group.id, lang)
                                    }
                                    className="absolute top-2 right-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white opacity-0 transition-colors group-hover/video:opacity-100 hover:bg-red-600"
                                    title={`Remove ${LANG_INFO[lang as SupportedLanguage]?.name || lang} video`}
                                  >
                                    <X className="h-4 w-4" />
                                  </button>
                                </div>
                              ),
                          )}
                          <button
                            onClick={() =>
                              handleOpenUploadDialog('shorts', group.id)
                            }
                            className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-300 bg-gray-50 text-gray-500 transition-colors hover:border-pink-400 hover:bg-pink-50 hover:text-pink-600 dark:border-gray-600 dark:bg-gray-800/50 dark:hover:border-pink-500 dark:hover:bg-gray-700/50 dark:hover:text-pink-400"
                          >
                            <Plus className="h-6 w-6" />
                            <span className="text-sm font-medium">
                              Add Language
                            </span>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            {/* Published Content Section */}
            {(sortedPublishes ?? []).length > 0 && (
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
                        onClick={() =>
                          setSortOrder((prev) =>
                            prev === 'asc' ? 'desc' : 'asc',
                          )
                        }
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
                        onClick={() => refetchPublishes()}
                        disabled={loadingPublishes || fetchingPublishes}
                        title="Refresh"
                      >
                        <RefreshCw
                          className={`h-4 w-4 ${fetchingPublishes ? 'animate-spin' : ''}`}
                        />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:bg-red-50 hover:text-red-700"
                        onClick={() => setDeleteAllDialogOpen(true)}
                        title="Clear All"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {(sortedPublishes ?? []).map((pub) => {
                      const _config = PLATFORM_CONFIG[pub.platform];
                      return (
                        <div
                          key={pub.id}
                          className="bg-card flex items-center justify-between rounded-lg border p-3"
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
                                  {pub.status}
                                </Badge>
                                {pub.contentType === 'short' && (
                                  <Badge
                                    variant="outline"
                                    className="text-pink-600"
                                  >
                                    Short
                                  </Badge>
                                )}
                              </div>
                              {pub.analytics && (
                                <div className="mt-1 flex items-center gap-3 text-xs text-gray-500">
                                  <span className="flex items-center gap-1">
                                    <Eye className="h-3 w-3" />
                                    {pub.analytics.views.toLocaleString()}
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
                                <p className="mt-1 text-xs text-red-500">
                                  {pub.error}
                                </p>
                              )}
                              {/* Show scheduled time for scheduled posts */}
                              {pub.status === 'scheduled' &&
                                pub.scheduledAt && (
                                  <p className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
                                    <Clock className="h-3 w-3" />
                                    Scheduled for{' '}
                                    {format(new Date(pub.scheduledAt), 'PPp')}
                                  </p>
                                )}
                              {/* Show published time for published posts */}
                              {pub.status === 'published' &&
                                pub.publishedAt && (
                                  <p className="text-muted-foreground mt-1 text-xs">
                                    Published{' '}
                                    {format(new Date(pub.publishedAt), 'PPp')}
                                  </p>
                                )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            {pub.platformUrl && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  window.open(pub.platformUrl ?? '', '_blank')
                                }
                                title="Open on platform"
                              >
                                <ExternalLink className="h-4 w-4" />
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-red-500 hover:bg-red-50 hover:text-red-700"
                              onClick={() =>
                                initiateUnpublish(
                                  pub.id,
                                  pub.platform,
                                  pub.channelName,
                                )
                              }
                              title="Delete from platform"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Right: Settings & Connected Channels */}
          <div className="space-y-6">
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
                      setMetadata({ ...metadata, title: e.target.value })
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
                      setMetadata({ ...metadata, description: e.target.value })
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
                      setMetadata({ ...metadata, tags: e.target.value })
                    }
                    placeholder="animation, kids, story"
                  />
                  <p className="mt-1 text-xs text-gray-500">Comma-separated</p>
                </div>
              </CardContent>
            </Card>

            {/* Schedule Release */}
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
                description: metadata.description || episode.description || '',
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

            {/* Connected Channels */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Connected Channels</CardTitle>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => refetchConnections()}
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
                ) : (connections?.length ?? 0) === 0 ? (
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
                    {Object.entries(channelsByLanguage).map(
                      ([lang, channels]) => (
                        <div key={lang}>
                          <div className="mb-2 flex items-center gap-2">
                            <span>
                              {LANG_INFO[lang as SupportedLanguage]?.flag ??
                                '🌐'}
                            </span>
                            <span className="text-sm font-medium">
                              {LANG_INFO[lang as SupportedLanguage]?.name ??
                                lang.toUpperCase()}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {channels.map((conn) => (
                              <ChannelBadge
                                key={conn.id}
                                conn={conn}
                                size="md"
                              />
                            ))}
                          </div>
                        </div>
                      ),
                    )}
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
          </div>
        </div>

        {/* Upload Dialog */}
        <Dialog
          open={uploadDialogOpen}
          onOpenChange={(open) => {
            setUploadDialogOpen(open);
            if (!open) setSelectedFile(null);
          }}
        >
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Upload {uploadType === 'full' ? 'Full Video' : 'Short'}
              </DialogTitle>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div>
                <Label>Select Language</Label>
                <Select
                  value={selectedLanguage}
                  onValueChange={(val) =>
                    setSelectedLanguage(val as SupportedLanguage)
                  }
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(uploadType === 'full'
                      ? getAvailableLanguages()
                      : getAvailableLanguagesForGroup(selectedGroupId ?? '')
                    ).map((lang) => (
                      <SelectItem key={lang} value={lang}>
                        <span className="mr-2">{LANG_INFO[lang].flag}</span>
                        {LANG_INFO[lang].name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Show destination channels for selected language */}
              <div>
                <Label>Will publish to:</Label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {(channelsByLanguage[selectedLanguage] ?? [])
                    .filter((c) =>
                      uploadType === 'full'
                        ? ['youtube', 'facebook'].includes(c.platform)
                        : [
                          'youtube',
                          'instagram',
                          'facebook',
                          'tiktok',
                        ].includes(c.platform),
                    )
                    .map((conn) => (
                      <ChannelBadge key={conn.id} conn={conn} size="md" />
                    ))}
                  {(channelsByLanguage[selectedLanguage] ?? []).length ===
                    0 && (
                      <p className="text-sm text-amber-600">
                        No channels connected for{' '}
                        {LANG_INFO[selectedLanguage].name}.
                        <a
                          href={`/home/${accountSlug}/settings/platforms`}
                          className="ml-1 underline"
                        >
                          Connect channels
                        </a>
                      </p>
                    )}
                </div>
              </div>

              <div>
                <Label>Video File</Label>
                <div
                  {...getRootProps()}
                  className={`mt-1 cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors ${isDragActive
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20'
                    : 'border-gray-300 hover:border-indigo-400 dark:border-gray-600'
                    }`}
                >
                  <input {...getInputProps()} />
                  {selectedFile ? (
                    <div className="flex items-center justify-center gap-2">
                      <Video className="h-5 w-5 text-indigo-500" />
                      <span className="font-medium">{selectedFile.name}</span>
                      <span className="text-sm text-gray-500">
                        ({(selectedFile.size / 1024 / 1024).toFixed(1)} MB)
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedFile(null);
                        }}
                        className="ml-2 text-gray-400 hover:text-red-500"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <div>
                      <Upload className="mx-auto mb-2 h-8 w-8 text-gray-400" />
                      <p className="text-sm text-gray-500">
                        Drag & drop, or click to select
                      </p>
                      <p className="mt-1 text-xs text-gray-400">
                        {uploadType === 'full' ? '16:9' : '9:16'} • MP4, MOV,
                        WebM • Max 500MB
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <Button
                onClick={handleUpload}
                disabled={!selectedFile || isUploading || isPending}
                className="w-full"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <Upload className="mr-2 h-4 w-4" />
                    Upload
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </>
  );
}
