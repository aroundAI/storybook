'use client';

/**
 * UploadAudioDialog Component
 *
 * Dialog for uploading audio files (music or SFX) to the library.
 *
 * The file goes straight to storage through the presign route, and a small
 * action records it (KB-73). It used to travel as base64 in a server-action
 * body, which Next caps at 1 MB.
 */
import { useCallback, useRef, useState } from 'react';
import { useTransition } from 'react';

import { FileAudio, Loader2, Music, Upload, Volume2, X } from 'lucide-react';

import { createUploadedAudioAssetAction } from '@kit/audio-generation/server';
import { refusalMessage, unwrap } from '@kit/next/action-result';
import { uploadWithPresignedUrl } from '@kit/storage/client';
import {
  audioLibraryUploadPath,
  audioLibraryUploadType,
} from '@kit/storage/upload-paths';
import { Button } from '@kit/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@kit/ui/dialog';
import { Input } from '@kit/ui/input';
import { Label } from '@kit/ui/label';
import { Tabs, TabsList, TabsTrigger } from '@kit/ui/tabs';
import { cn } from '@kit/ui/utils';

import type { AudioAsset } from './audio-asset-card';

interface UploadAudioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onSuccess?: (asset: AudioAsset) => void;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export function UploadAudioDialog({
  open,
  onOpenChange,
  projectId,
  onSuccess,
}: UploadAudioDialogProps) {
  const [isPending, startTransition] = useTransition();
  const [audioType, setAudioType] = useState<'music' | 'sfx'>('music');
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateFile = (f: File): string | null => {
    if (!audioLibraryUploadType(f.type, f.name)) {
      return 'Invalid file type. Please upload MP3, WAV, or M4A.';
    }
    if (f.size > MAX_FILE_SIZE) {
      return 'File too large. Maximum size is 50MB.';
    }
    return null;
  };

  const handleFile = (f: File) => {
    const validationError = validateFile(f);
    if (validationError) {
      setError(validationError);
      return;
    }
    setError(null);
    setFile(f);
    if (!name) {
      // Auto-fill name from filename
      setName(f.name.replace(/\.[^.]+$/, ''));
    }
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) {
      handleFile(droppedFile);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      handleFile(selectedFile);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file');
      return;
    }
    if (!name.trim()) {
      setError('Please enter a name');
      return;
    }

    const contentType = audioLibraryUploadType(file.type, file.name);

    if (!contentType) {
      setError('Invalid file type. Please upload MP3, WAV, or M4A.');
      return;
    }

    setError(null);
    startTransition(async () => {
      try {
        const path = audioLibraryUploadPath(projectId, contentType);

        // The presign route's refusals are written for the user ("You do not
        // have permission…", "File is 60 MB…"); show them as they are
        try {
          await uploadWithPresignedUrl(file, 'project-assets', path, {
            contentType,
          });
        } catch (uploadError) {
          setError(
            uploadError instanceof Error
              ? uploadError.message
              : 'Failed to upload audio',
          );
          return;
        }

        const asset = await unwrap(
          createUploadedAudioAssetAction({
            projectId,
            audioType,
            name: name.trim(),
            path,
            contentType,
            fileSizeBytes: file.size,
          }),
        );

        reset();
        onOpenChange(false);
        onSuccess?.({
          id: asset.id,
          name: asset.name,
          audioType: asset.audioType,
          prompt: asset.prompt,
          fileUrl: asset.fileUrl,
          durationSeconds: asset.durationSeconds,
          status: asset.status,
          usageCount: asset.usageCount,
          createdAt: asset.createdAt,
          source: 'uploaded',
        });
      } catch (err) {
        setError(refusalMessage(err, 'Failed to upload audio'));
      }
    });
  };

  // A cleared input is what lets the same file be chosen again: the browser
  // fires no change event for a value the input already holds
  const reset = () => {
    setFile(null);
    setName('');
    setError(null);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next && !isPending) reset();
    onOpenChange(next);
  };

  const handleRemoveFile = () => {
    setFile(null);
    setError(null);
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5 text-primary" />
            Upload Audio
          </DialogTitle>
          <DialogDescription>
            Upload your own music or sound effects to the library
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Audio Type Tabs */}
          <Tabs
            value={audioType}
            onValueChange={(v) => setAudioType(v as 'music' | 'sfx')}
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="music" className="gap-1.5">
                <Music className="h-4 w-4" />
                Music
              </TabsTrigger>
              <TabsTrigger value="sfx" className="gap-1.5">
                <Volume2 className="h-4 w-4" />
                Sound Effects
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {/* Drop Zone */}
          <div
            className={cn(
              'relative flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors',
              dragActive
                ? 'border-primary bg-primary/5'
                : 'border-muted-foreground/25 hover:border-primary/50',
              file && 'border-green-500 bg-green-50 dark:bg-green-950/20',
            )}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              data-test="audio-upload-file"
              accept=".mp3,.wav,.m4a,audio/mpeg,audio/wav,audio/x-m4a"
              onChange={handleInputChange}
              className="hidden"
            />

            {file ? (
              <div className="flex items-center gap-3">
                <FileAudio className="h-8 w-8 text-green-600" />
                <div className="text-left">
                  <p className="text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(file.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveFile();
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <>
                <Upload className="mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium">
                  Drop audio file here or click to browse
                </p>
                <p className="text-xs text-muted-foreground">
                  MP3, WAV, M4A • Max 50MB
                </p>
              </>
            )}
          </div>

          {/* Name */}
          <div className="space-y-2">
            <Label htmlFor="upload-name">Name *</Label>
            <Input
              id="upload-name"
              data-test="audio-upload-name"
              placeholder={
                audioType === 'music' ? 'Background Score' : 'Door Creak'
              }
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          {/* Error */}
          {error && (
            <p
              data-test="audio-upload-error"
              className="text-sm text-destructive"
            >
              {error}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            data-test="audio-upload-submit"
            onClick={handleUpload}
            disabled={isPending || !file}
          >
            {isPending ? (
              <>
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="mr-1.5 h-4 w-4" />
                Upload
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
