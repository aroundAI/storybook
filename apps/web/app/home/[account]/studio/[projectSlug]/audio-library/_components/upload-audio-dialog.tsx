'use client';

/**
 * UploadAudioDialog Component
 * 
 * Dialog for uploading audio files (music or SFX) to the library.
 */

import { useState, useRef, useCallback } from 'react';
import { useTransition } from 'react';
import { Upload, Music, Volume2, Loader2, X, FileAudio } from 'lucide-react';

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

interface UploadAudioDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    projectId: string;
    onSuccess?: () => void;
}

const ACCEPTED_TYPES = ['audio/mpeg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/x-m4a'];
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
        if (!ACCEPTED_TYPES.includes(f.type)) {
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

        setError(null);
        startTransition(async () => {
            try {
                // 1. Upload file to storage
                const { getStorageAdapter } = await import('@kit/storage');
                const storage = getStorageAdapter();

                const fileName = `${audioType}/${Date.now()}-${file.name.replace(/\s+/g, '_')}`;

                // Convert File to Buffer
                const arrayBuffer = await file.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                const uploadResult = await storage.upload(
                    'audio-assets',
                    fileName,
                    buffer,
                    { contentType: file.type },
                );

                // 2. Create audio asset record
                const { uploadAudioAssetAction } = await import(
                    '@kit/audio-generation/server'
                );

                await uploadAudioAssetAction({
                    projectId,
                    audioType,
                    name: name.trim(),
                    fileUrl: uploadResult.url,
                    filePath: fileName,
                    fileSizeBytes: file.size,
                });

                onOpenChange(false);
                onSuccess?.();

                // Reset form
                setFile(null);
                setName('');
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Failed to upload audio');
            }
        });
    };

    const handleRemoveFile = () => {
        setFile(null);
        setError(null);
        if (inputRef.current) {
            inputRef.current.value = '';
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
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
                            placeholder={audioType === 'music' ? 'Background Score' : 'Door Creak'}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </div>

                    {/* Error */}
                    {error && (
                        <p className="text-sm text-destructive">{error}</p>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button onClick={handleUpload} disabled={isPending || !file}>
                        {isPending ? (
                            <>
                                <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                                Uploading...
                            </>
                        ) : (
                            <>
                                <Upload className="h-4 w-4 mr-1.5" />
                                Upload
                            </>
                        )}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
