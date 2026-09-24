'use client';

/**
 * AudioLibraryClient Component
 *
 * Client-side wrapper for the audio library with state management.
 */
import { useState } from 'react';

import { useRouter } from 'next/navigation';

import {
  type AudioAsset,
  AudioAssetGrid,
  GenerateAudioDialog,
  UploadAudioDialog,
} from './index';

interface AudioLibraryClientProps {
  projectId: string;
  initialAssets: AudioAsset[];
}

export function AudioLibraryClient({
  projectId,
  initialAssets,
}: AudioLibraryClientProps) {
  const router = useRouter();
  const [state, setState] = useState<{
    dialog: 'generate' | 'upload' | null;
    /** Uploaded here, shown before the server list catches up */
    added: AudioAsset[];
    /** Hidden here; nothing deletes them yet */
    hidden: string[];
  }>({ dialog: null, added: [], hidden: [] });

  // The server list is the source of truth, so `router.refresh()` shows what
  // it brings. Holding the list in state from `initialAssets` ignored every
  // later render, so a new asset appeared only after a reload (KB-79).
  const serverIds = new Set(initialAssets.map((asset) => asset.id));
  const assets = [
    ...state.added.filter((asset) => !serverIds.has(asset.id)),
    ...initialAssets,
  ].filter((asset) => !state.hidden.includes(asset.id));

  const setDialog = (dialog: 'generate' | 'upload' | null) =>
    setState((prev) => ({ ...prev, dialog }));

  const handleDelete = async (assetId: string) => {
    // TODO: Call delete action
    setState((prev) => ({ ...prev, hidden: [...prev.hidden, assetId] }));
  };

  const handleUploaded = (asset: AudioAsset) => {
    setState((prev) => ({ ...prev, added: [asset, ...prev.added] }));
    router.refresh();
  };

  return (
    <>
      <AudioAssetGrid
        assets={assets}
        onDelete={handleDelete}
        onGenerate={() => setDialog('generate')}
        onUpload={() => setDialog('upload')}
      />

      <GenerateAudioDialog
        open={state.dialog === 'generate'}
        onOpenChange={(open) => setDialog(open ? 'generate' : null)}
        projectId={projectId}
        onSuccess={() => router.refresh()}
      />

      <UploadAudioDialog
        open={state.dialog === 'upload'}
        onOpenChange={(open) => setDialog(open ? 'upload' : null)}
        projectId={projectId}
        onSuccess={handleUploaded}
      />
    </>
  );
}
