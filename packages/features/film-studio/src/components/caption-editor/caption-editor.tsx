'use client';

import { useCallback, useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Languages, Subtitles, Wand2 } from 'lucide-react';

import { Button } from '@kit/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@kit/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { Skeleton } from '@kit/ui/skeleton';
import { toast } from '@kit/ui/sonner';

import { LANGUAGE_NAMES, getLanguageName } from '../../lib/caption-utils';
import type { CaptionStylePreset } from '../../lib/schemas/caption.schema';
import {
  deleteCaptionAction,
  exportCaptionsAction,
  generateCaptionsAction,
  getAvailableLanguagesAction,
  getCaptionsAction,
  updateCaptionStyleAction,
} from '../../server/caption-actions';
import { CaptionSegmentList } from './caption-segment-list';
import { CaptionStyleSelector } from './caption-style-selector';
import { TranslateDialog } from './translate-dialog';

interface CaptionEditorProps {
  episodeId: string;
  currentTime?: number;
  onSeek?: (time: number) => void;
}

export function CaptionEditor({
  episodeId,
  currentTime = 0,
  onSeek,
}: CaptionEditorProps) {
  const queryClient = useQueryClient();
  const [selectedLanguage, setSelectedLanguage] = useState('en');
  const [translateDialogOpen, setTranslateDialogOpen] = useState(false);

  // Fetch captions
  const {
    data: captions,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['captions', episodeId, selectedLanguage],
    queryFn: () => getCaptionsAction({ episodeId, language: selectedLanguage }),
  });

  // Fetch available languages
  const { data: availableLanguages } = useQuery<
    { code: string; name: string }[]
  >({
    queryKey: ['caption-languages', episodeId],
    queryFn: () => getAvailableLanguagesAction({ episodeId }),
  });

  const currentCaption = captions?.[0];

  // Generate captions mutation
  const generateMutation = useMutation({
    mutationFn: generateCaptionsAction,
    onSuccess: () => {
      toast.success('Captions generated successfully');
      queryClient.invalidateQueries({ queryKey: ['captions', episodeId] });
      queryClient.invalidateQueries({
        queryKey: ['caption-languages', episodeId],
      });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error ? error.message : 'Failed to generate captions',
      );
    },
  });

  // Export mutation
  const exportMutation = useMutation({
    mutationFn: exportCaptionsAction,
    onSuccess: (data) => {
      // Download file
      const blob = new Blob([data.content], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Exported captions as ${data.format.toUpperCase()}`);
    },
    onError: () => {
      toast.error('Failed to export captions');
    },
  });

  // Style update mutation
  const styleMutation = useMutation({
    mutationFn: updateCaptionStyleAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['captions', episodeId] });
      toast.success('Style updated');
    },
    onError: () => {
      toast.error('Failed to update style');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: deleteCaptionAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['captions', episodeId] });
      queryClient.invalidateQueries({
        queryKey: ['caption-languages', episodeId],
      });
      toast.success('Captions deleted');
    },
    onError: () => {
      toast.error('Failed to delete captions');
    },
  });

  const handleGenerate = useCallback(() => {
    generateMutation.mutate({
      episodeId,
      language: selectedLanguage,
      stylePreset: 'standard',
    });
  }, [generateMutation, episodeId, selectedLanguage]);

  const handleExport = useCallback(
    (format: 'srt' | 'vtt') => {
      if (!currentCaption) return;
      exportMutation.mutate({
        captionId: currentCaption.id,
        format,
      });
    },
    [exportMutation, currentCaption],
  );

  const handleStyleChange = useCallback(
    (stylePreset: CaptionStylePreset) => {
      if (!currentCaption) return;
      styleMutation.mutate({
        captionId: currentCaption.id,
        stylePreset,
      });
    },
    [styleMutation, currentCaption],
  );

  const handleDelete = useCallback(() => {
    if (!currentCaption) return;
    if (
      !window.confirm(
        `Are you sure you want to delete ${getLanguageName(currentCaption.language)} captions?`,
      )
    ) {
      return;
    }
    deleteMutation.mutate({ captionId: currentCaption.id });
  }, [deleteMutation, currentCaption]);

  const handleTranslateSuccess = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['captions', episodeId] });
    queryClient.invalidateQueries({
      queryKey: ['caption-languages', episodeId],
    });
    setTranslateDialogOpen(false);
  }, [queryClient, episodeId]);

  if (isLoading) {
    return <CaptionEditorSkeleton />;
  }

  if (error) {
    return (
      <Card>
        <CardContent className="text-destructive py-8 text-center">
          Failed to load captions. Please try again.
        </CardContent>
      </Card>
    );
  }

  const hasExistingCaptions = (availableLanguages?.length ?? 0) > 0;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
          <div className="flex items-center gap-2">
            <Subtitles className="h-5 w-5" />
            <CardTitle className="text-lg font-medium">Captions</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={selectedLanguage}
              onValueChange={setSelectedLanguage}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(LANGUAGE_NAMES).map(([code, name]) => (
                  <SelectItem key={code} value={code}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            {!currentCaption ? (
              <Button
                size="sm"
                onClick={handleGenerate}
                disabled={generateMutation.isPending}
              >
                <Wand2 className="mr-1 h-4 w-4" />
                {generateMutation.isPending
                  ? 'Generating...'
                  : 'Generate Captions'}
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleExport('srt')}
                  disabled={exportMutation.isPending}
                >
                  <Download className="mr-1 h-4 w-4" />
                  SRT
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleExport('vtt')}
                  disabled={exportMutation.isPending}
                >
                  <Download className="mr-1 h-4 w-4" />
                  VTT
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setTranslateDialogOpen(true)}
                >
                  <Languages className="mr-1 h-4 w-4" />
                  Translate
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                  className="text-destructive hover:text-destructive"
                >
                  Delete
                </Button>
              </>
            )}
          </div>

          {/* Style Selector */}
          {currentCaption && (
            <CaptionStyleSelector
              currentStyle={currentCaption.stylePreset as CaptionStylePreset}
              onStyleChange={handleStyleChange}
              disabled={styleMutation.isPending}
            />
          )}

          {/* Segment List */}
          {currentCaption && currentCaption.segments.length > 0 ? (
            <CaptionSegmentList
              segments={currentCaption.segments}
              currentTime={currentTime}
              onSegmentClick={onSeek}
            />
          ) : currentCaption ? (
            <div className="text-muted-foreground py-8 text-center">
              No caption segments found.
            </div>
          ) : (
            <div className="text-muted-foreground py-8 text-center">
              {hasExistingCaptions
                ? `No ${getLanguageName(selectedLanguage)} captions. Generate or translate from another language.`
                : 'No captions found. Generate captions from dialogue audio.'}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Translate Dialog */}
      {currentCaption && (
        <TranslateDialog
          open={translateDialogOpen}
          onOpenChange={setTranslateDialogOpen}
          sourceCaptionId={currentCaption.id}
          sourceLanguage={currentCaption.language}
          existingLanguages={availableLanguages?.map((l) => l.code) ?? []}
          onSuccess={handleTranslateSuccess}
        />
      )}
    </>
  );
}

function CaptionEditorSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-9 w-32" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
        <Skeleton className="h-10 w-full" />
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </CardContent>
    </Card>
  );
}
