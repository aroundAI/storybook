'use client';

/**
 * AudioLibraryClient Component
 * 
 * Client-side wrapper for the audio library with state management.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { AudioAssetGrid, type AudioAsset, GenerateAudioDialog, UploadAudioDialog } from './index';

interface AudioLibraryClientProps {
    projectId: string;
    initialAssets: AudioAsset[];
}

export function AudioLibraryClient({
    projectId,
    initialAssets,
}: AudioLibraryClientProps) {
    const router = useRouter();
    const [isGenerateOpen, setIsGenerateOpen] = useState(false);
    const [isUploadOpen, setIsUploadOpen] = useState(false);
    const [assets, setAssets] = useState(initialAssets);

    const handleDelete = async (assetId: string) => {
        // TODO: Call delete action
        setAssets((prev) => prev.filter((a) => a.id !== assetId));
    };

    const handleSuccess = () => {
        // Refresh page to get new assets
        router.refresh();
    };

    return (
        <>
            <AudioAssetGrid
                assets={assets}
                onDelete={handleDelete}
                onGenerate={() => setIsGenerateOpen(true)}
                onUpload={() => setIsUploadOpen(true)}
            />

            <GenerateAudioDialog
                open={isGenerateOpen}
                onOpenChange={setIsGenerateOpen}
                projectId={projectId}
                onSuccess={handleSuccess}
            />

            <UploadAudioDialog
                open={isUploadOpen}
                onOpenChange={setIsUploadOpen}
                projectId={projectId}
                onSuccess={handleSuccess}
            />
        </>
    );
}
