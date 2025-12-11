'use client';

import { useState } from 'react';

import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Link2,
} from 'lucide-react';

import { Badge } from '@kit/ui/badge';
import { Button } from '@kit/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@kit/ui/card';
import { Checkbox } from '@kit/ui/checkbox';
import { Input } from '@kit/ui/input';
import { toast } from '@kit/ui/sonner';
import { Textarea } from '@kit/ui/textarea';

import type { Platform } from '../lib/export-package-types';
import {
  PLATFORM_NAMES,
  PLATFORM_UPLOAD_URLS,
} from '../lib/export-package-types';
import {
  generateExportPackageAction,
  markAsExternallyUploadedAction,
} from '../server/upload-only-actions';

interface UploadOnlyModeProps {
  episodeId: string;
  platform: Platform;
}

const PLATFORM_ICONS: Record<Platform, React.ReactNode> = {
  youtube: (
    <svg
      className="h-6 w-6"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  ),
  tiktok: <span className="text-lg font-bold">TT</span>,
  instagram: (
    <svg
      className="h-6 w-6"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
    </svg>
  ),
  facebook: <span className="text-lg font-bold">FB</span>,
};

export function UploadOnlyMode({ episodeId, platform }: UploadOnlyModeProps) {
  const [completedSteps, setCompletedSteps] = useState<number[]>([]);
  const [platformUrl, setPlatformUrl] = useState('');

  const {
    data: exportPackage,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['export-package', episodeId, platform],
    queryFn: () => generateExportPackageAction({ episodeId, platform }),
  });

  const markUploadedMutation = useMutation({
    mutationFn: markAsExternallyUploadedAction,
    onSuccess: () => {
      toast.success('Marked as uploaded successfully');
      setPlatformUrl('');
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : 'Failed to mark as uploaded',
      );
    },
  });

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label} copied to clipboard`);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  const toggleStep = (step: number) => {
    setCompletedSteps((prev) =>
      prev.includes(step) ? prev.filter((s) => s !== step) : [...prev, step],
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-muted-foreground">
          Generating export package...
        </div>
      </div>
    );
  }

  if (error || !exportPackage) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-destructive">
          {error instanceof Error
            ? error.message
            : 'Failed to generate export package'}
        </div>
      </div>
    );
  }

  const platformName = PLATFORM_NAMES[platform];

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="bg-primary/10 flex h-12 w-12 items-center justify-center rounded-lg">
              {PLATFORM_ICONS[platform]}
            </div>
            <div>
              <CardTitle>Manual Upload to {platformName}</CardTitle>
              <CardDescription>
                Upload through {platformName}&apos;s native interface for
                advanced options
              </CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Downloads */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Download className="h-4 w-4" />
            Download Files
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-3">
              <FileText className="text-muted-foreground h-5 w-5" />
              <div>
                <p className="text-sm font-medium">
                  {exportPackage.video.filename}
                </p>
                <p className="text-muted-foreground text-xs">
                  {exportPackage.video.resolution} •{' '}
                  {Math.round(exportPackage.video.duration)}s
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" asChild>
              <a href={exportPackage.video.url} download>
                <Download className="mr-1 h-4 w-4" />
                Download
              </a>
            </Button>
          </div>

          {exportPackage.thumbnail && (
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="flex items-center gap-3">
                <ImageIcon className="text-muted-foreground h-5 w-5" />
                <div>
                  <p className="text-sm font-medium">
                    {exportPackage.thumbnail.filename}
                  </p>
                  <p className="text-muted-foreground text-xs">
                    {exportPackage.thumbnail.dimensions.width}x
                    {exportPackage.thumbnail.dimensions.height}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" asChild>
                <a href={exportPackage.thumbnail.url} download>
                  <Download className="mr-1 h-4 w-4" />
                  Download
                </a>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Metadata */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Copy Metadata</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Title */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Title</label>
            <div className="flex gap-2">
              <Input
                value={exportPackage.metadata.title}
                readOnly
                className="flex-1"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={() =>
                  copyToClipboard(exportPackage.metadata.title, 'Title')
                }
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Description</label>
            <div className="flex gap-2">
              <Textarea
                value={exportPackage.metadata.description}
                readOnly
                className="flex-1"
                rows={4}
              />
              <Button
                variant="outline"
                size="icon"
                className="self-start"
                onClick={() =>
                  copyToClipboard(
                    exportPackage.metadata.description,
                    'Description',
                  )
                }
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Tags */}
          {exportPackage.metadata.tags.length > 0 && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Tags</label>
              <div className="flex gap-2">
                <div className="flex flex-1 flex-wrap gap-1 rounded-md border p-2">
                  {exportPackage.metadata.tags.map((tag, i) => (
                    <Badge key={i} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() =>
                    copyToClipboard(
                      exportPackage.metadata.tags.join(', '),
                      'Tags',
                    )
                  }
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Upload Checklist */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Upload Checklist</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {exportPackage.uploadInstructions.map((instruction) => (
            <div
              key={instruction.step}
              className={`flex items-start gap-3 rounded-lg border p-3 transition-colors ${
                completedSteps.includes(instruction.step)
                  ? 'border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950'
                  : ''
              }`}
            >
              <Checkbox
                checked={completedSteps.includes(instruction.step)}
                onCheckedChange={() => toggleStep(instruction.step)}
              />
              <div className="flex-1">
                <p className="text-sm font-medium">{instruction.action}</p>
                {instruction.details && (
                  <p className="text-muted-foreground mt-1 text-xs">
                    {instruction.details}
                  </p>
                )}
              </div>
              {instruction.link && (
                <Button variant="ghost" size="sm" asChild>
                  <a
                    href={instruction.link}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </Button>
              )}
            </div>
          ))}

          <Button className="w-full" asChild>
            <a
              href={PLATFORM_UPLOAD_URLS[platform]}
              target="_blank"
              rel="noopener noreferrer"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Open {platformName} Upload Page
            </a>
          </Button>
        </CardContent>
      </Card>

      {/* Link Input */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Link2 className="h-4 w-4" />
            Link Your Upload
          </CardTitle>
          <CardDescription>
            After uploading, paste the video URL here to track analytics
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder={`Paste your ${platformName} video URL...`}
              value={platformUrl}
              onChange={(e) => setPlatformUrl(e.target.value)}
              className="flex-1"
            />
            <Button
              onClick={() =>
                markUploadedMutation.mutate({
                  episodeId,
                  platform,
                  platformUrl,
                })
              }
              disabled={!platformUrl || markUploadedMutation.isPending}
            >
              <Check className="mr-1 h-4 w-4" />
              Mark as Uploaded
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
