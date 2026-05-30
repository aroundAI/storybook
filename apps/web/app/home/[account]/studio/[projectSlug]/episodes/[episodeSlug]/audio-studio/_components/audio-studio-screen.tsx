'use client';

import { useCallback, useRef, useState, useTransition } from 'react';

import type { EpisodeWithShots } from '@kit/episodes/types';

import { exportAudioData } from './audio-export';
import { AudioStudioHeader, type ActiveTab } from './audio-studio-header';
import { BatchProgressBar } from './batch-progress-bar';
import { DialogueTimeline } from './dialogue-timeline';
import {
  MusicTimeline,
  type MusicTimelineHandle,
} from './music-timeline';
import {
  SfxTimeline,
  type SfxTimelineHandle,
} from './sfx-timeline';
import { useAudioStudioData } from './use-audio-studio-data';
import { useBatchGeneration } from './use-batch-generation';
import { useTimelineZoom } from './use-timeline-zoom';

interface AudioStudioScreenProps {
  episode: EpisodeWithShots;
  refetchEpisode: () => void;
}

export function AudioStudioScreen({
  episode,
  refetchEpisode,
}: AudioStudioScreenProps) {
  const [isPending, startTransition] = useTransition();
  const [activeTab, setActiveTab] = useState<ActiveTab>('dialogue');

  // Data hook: fetches, caches, and manages all audio studio data
  const data = useAudioStudioData(
    episode,
    refetchEpisode,
    isPending,
    startTransition,
  );

  // Batch generation hook: polling, generate/cancel/clear actions
  const batch = useBatchGeneration(
    episode.id,
    data.selectedLanguage,
    data.fetchDialogueForLanguage,
    data.refreshAll,
    refetchEpisode,
    data.dialogueStats.completed,
    isPending,
    startTransition,
  );

  // Timeline zoom hook
  const zoom = useTimelineZoom();

  // Music & SFX timeline refs for imperative actions
  const musicTimelineRef = useRef<MusicTimelineHandle>(null);
  const sfxTimelineRef = useRef<SfxTimelineHandle>(null);

  // Export state (kept here since it's a simple flag)
  const [_isExporting, setIsExporting] = useState(false);

  const handleExport = useCallback(async () => {
    await exportAudioData(
      data.dialogueLines,
      data.characters,
      episode.title,
      setIsExporting,
    );
  }, [data.dialogueLines, data.characters, episode.title]);

  const hasNoCues = data.musicStats.total === 0 && data.sfxStats.total === 0;

  return (
    <div className="flex h-full">
      {/* Main Content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header Bar */}
        <AudioStudioHeader
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          dialogueStats={data.dialogueStats}
          musicStats={data.musicStats}
          sfxStats={data.sfxStats}
          episodeId={episode.id}
          languageTabBarProps={{
            availableLanguages: data.availableLanguages,
            selectedLanguage: data.selectedLanguage,
            onLanguageChange: data.setSelectedLanguage,
            onLanguageAdded: data.refreshAll,
          }}
          pixelsPerSecond={zoom.pixelsPerSecond}
          onZoomIn={zoom.zoomIn}
          onZoomOut={zoom.zoomOut}
          onFitToWindow={() => zoom.fitToWindow(data.totalDuration)}
          isPending={isPending}
          isGenerating={batch.isGenerating}
          onClearAllVoices={batch.handleClearAllVoices}
          onCancelBatch={batch.handleCancelBatch}
          onGenerateAll={batch.handleGenerateAll}
          hasNoCues={hasNoCues}
          isGeneratingCues={data.isGeneratingCues}
          onGenerateAudioCues={data.handleGenerateAudioCues}
          onGenerateAllMusic={() => musicTimelineRef.current?.generateAll()}
          onGenerateAllSfx={() => sfxTimelineRef.current?.generateAll()}
          musicPendingCount={data.musicStats.pending}
          sfxPendingCount={data.sfxStats.pending}
          onExport={handleExport}
        />

        {/* Batch Generation Progress Bar */}
        {batch.batchStatus && (
          <BatchProgressBar
            batchStatus={batch.batchStatus}
            isGenerating={batch.isGenerating}
            onDismiss={() => {
              batch.setBatchStatus(null);
              batch.setBatchJobId(null);
            }}
          />
        )}

        {/* Timeline Content */}
        <div ref={zoom.timelineContainerRef} className="flex-1 overflow-hidden">
          {activeTab === 'dialogue' && (
            <DialogueTimeline
              dialogueLines={data.dialogueLines}
              characters={data.characters}
              isLoading={data.isLoading}
              onRefresh={data.refreshAll}
              pixelsPerSecond={zoom.pixelsPerSecond}
              audioSettings={data.audioSettings}
            />
          )}

          {activeTab === 'music' && (
            <MusicTimeline
              ref={musicTimelineRef}
              episodeId={episode.id}
              totalDuration={data.totalDuration}
              scenes={data.scenes}
              onRefresh={data.refreshAll}
              pixelsPerSecond={zoom.pixelsPerSecond}
              audioSettings={data.audioSettings}
              onStatsChange={data.setMusicStats}
              initialTracks={data.initialAudioTracks}
              initialCues={data.initialAudioCues}
            />
          )}

          {activeTab === 'sfx' && (
            <SfxTimeline
              ref={sfxTimelineRef}
              episodeId={episode.id}
              totalDuration={data.totalDuration}
              pixelsPerSecond={zoom.pixelsPerSecond}
              onRefresh={data.refreshAll}
              audioSettings={data.audioSettings}
              onStatsChange={data.setSfxStats}
              initialCues={data.initialAudioCues}
            />
          )}
        </div>
      </div>
    </div>
  );
}
