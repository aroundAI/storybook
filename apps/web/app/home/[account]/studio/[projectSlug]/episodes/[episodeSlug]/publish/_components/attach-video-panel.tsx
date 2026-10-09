'use client';

import { useCallback, useState, useTransition } from 'react';

import { zodResolver } from '@hookform/resolvers/zod';
import { Film, Link2, Loader2, Upload } from 'lucide-react';
import { useDropzone } from 'react-dropzone';
import { useForm } from 'react-hook-form';

import { updatePublishedVideoAction } from '@kit/episodes/server';
import { refusalMessage, unwrap } from '@kit/next/action-result';
import {
  LANG_INFO,
  SUPPORTED_LANGUAGES,
  type SupportedLanguage,
} from '@kit/publishing/lib/constants';
import { MarkAsExternallyUploadedSchema } from '@kit/publishing/lib/schemas/upload-only';
import { markAsExternallyUploadedAction } from '@kit/publishing/server/upload-only';
import { Button } from '@kit/ui/button';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@kit/ui/form';
import { Input } from '@kit/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';
import { toast } from '@kit/ui/sonner';

import { uploadPublishVideo } from '~/lib/presigned-upload';

const VIDEO_TYPES = {
  'video/mp4': ['.mp4'],
  'video/webm': ['.webm'],
  'video/quicktime': ['.mov'],
};

/**
 * FILM-2202: the Publish page for an episode with nothing to publish yet.
 * A finished video can come from anywhere: upload the file, or link one
 * already on a platform. No story, screenplay or shots are needed.
 */
export function AttachVideoPanel({
  episodeId,
  onAttached,
}: {
  episodeId: string;
  onAttached: () => void;
}) {
  return (
    <div
      className="mx-auto flex max-w-2xl flex-col gap-6 p-8"
      data-test="attach-video-panel"
    >
      <div className="text-center">
        <Film className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Add the finished video</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Publish any video you have. You don&apos;t need a story, screenplay or
          shots for it.
        </p>
      </div>

      <UploadVideo episodeId={episodeId} onAttached={onAttached} />

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" />
        or
        <div className="h-px flex-1 bg-border" />
      </div>

      <LinkPublishedVideo episodeId={episodeId} onAttached={onAttached} />
    </div>
  );
}

function UploadVideo({
  episodeId,
  onAttached,
}: {
  episodeId: string;
  onAttached: () => void;
}) {
  const [language, setLanguage] = useState<SupportedLanguage>('en');
  const [isUploading, startUpload] = useTransition();

  const onDrop = useCallback(
    (files: File[]) => {
      const file = files[0];
      if (!file) return;

      startUpload(async () => {
        try {
          const uploaded = await uploadPublishVideo(file, episodeId, language);

          await unwrap(
            updatePublishedVideoAction({
              episodeId,
              language,
              videoUrl: uploaded.url,
            }),
          );

          toast.success(`Video added for ${LANG_INFO[language].name}`);
          onAttached();
        } catch (error) {
          toast.error(refusalMessage(error, 'The video could not be added'));
        }
      });
    },
    [episodeId, language, onAttached],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: VIDEO_TYPES,
    maxFiles: 1,
    disabled: isUploading,
  });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">Upload a file</span>
        <Select
          value={language}
          onValueChange={(value) => setLanguage(value as SupportedLanguage)}
        >
          <SelectTrigger
            className="w-44"
            data-test="attach-video-language"
            aria-label="Video language"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORTED_LANGUAGES.map((code) => (
              <SelectItem key={code} value={code}>
                {LANG_INFO[code].name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div
        {...getRootProps()}
        data-test="attach-video-dropzone"
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border px-6 py-12 text-center transition-colors hover:border-primary/60 data-[active=true]:border-primary data-[active=true]:bg-primary/5"
        data-active={isDragActive}
      >
        <input {...getInputProps()} data-test="attach-video-input" />
        {isUploading ? (
          <>
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="text-sm">Uploading…</span>
          </>
        ) : (
          <>
            <Upload className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm">
              Drop an MP4, WebM or MOV here, or click to choose
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function LinkPublishedVideo({
  episodeId,
  onAttached,
}: {
  episodeId: string;
  onAttached: () => void;
}) {
  const [isLinking, startLink] = useTransition();

  const form = useForm({
    resolver: zodResolver(MarkAsExternallyUploadedSchema),
    defaultValues: { episodeId, platform: 'youtube' as const, platformUrl: '' },
  });

  const onSubmit = form.handleSubmit((values) =>
    startLink(async () => {
      try {
        await markAsExternallyUploadedAction(values);
        toast.success('Video linked');
        form.reset({ episodeId, platform: values.platform, platformUrl: '' });
        onAttached();
      } catch (error) {
        toast.error(refusalMessage(error, 'The video could not be linked'));
      }
    }),
  );

  return (
    <Form {...form}>
      <form
        onSubmit={onSubmit}
        className="flex flex-col gap-3"
        data-test="link-published-video-form"
      >
        <span className="text-sm font-medium">Already published?</span>
        <div className="flex gap-2">
          <FormField
            control={form.control}
            name="platform"
            render={({ field }) => (
              <FormItem className="w-36">
                <FormLabel className="sr-only">Platform</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger data-test="link-published-video-platform">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="youtube">YouTube</SelectItem>
                    <SelectItem value="tiktok">TikTok</SelectItem>
                    <SelectItem value="instagram">Instagram</SelectItem>
                    <SelectItem value="facebook">Facebook</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="platformUrl"
            render={({ field }) => (
              <FormItem className="flex-1">
                <FormLabel className="sr-only">Video link</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    placeholder="https://www.youtube.com/watch?v=…"
                    data-test="link-published-video-url"
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button
            type="submit"
            variant="outline"
            disabled={isLinking}
            data-test="link-published-video-submit"
          >
            {isLinking ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="h-4 w-4" />
            )}
            Link
          </Button>
        </div>
      </form>
    </Form>
  );
}
