'use client';

import {
  Loader2,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';

import type { SupportedLanguage } from '@kit/publishing/lib/constants';
import { LANG_INFO } from '@kit/publishing/lib/constants';
import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { Label } from '@kit/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@kit/ui/select';

import { ChannelBadge } from './platform-ui';
import type { PlatformConnection, VideoType } from './publish-types';

interface UploadVideoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  uploadType: VideoType;
  selectedLanguage: SupportedLanguage;
  onLanguageChange: (lang: SupportedLanguage) => void;
  availableLanguages: SupportedLanguage[];
  channelsForLanguage: PlatformConnection[];
  accountSlug?: string;
  isUploading: boolean;
  isPending: boolean;
  onUpload: (file: File) => void;
}

export function UploadVideoDialog({
  open,
  onOpenChange,
  uploadType,
  selectedLanguage,
  onLanguageChange,
  availableLanguages,
  channelsForLanguage,
  accountSlug,
  isUploading,
  isPending,
  onUpload,
}: UploadVideoDialogProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

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

  const handleUpload = () => {
    if (!selectedFile) return;
    onUpload(selectedFile);
  };

  const relevantChannels = channelsForLanguage.filter((c) =>
    uploadType === 'full'
      ? ['youtube', 'facebook'].includes(c.platform)
      : ['youtube', 'instagram', 'facebook', 'tiktok'].includes(c.platform),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setSelectedFile(null);
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
                onLanguageChange(val as SupportedLanguage)
              }
            >
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableLanguages.map((lang) => (
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
              {relevantChannels.map((conn) => (
                <ChannelBadge key={conn.id} conn={conn} size="md" />
              ))}
              {channelsForLanguage.length === 0 && (
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
              className={`mt-1 cursor-pointer rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
                isDragActive
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
  );
}
