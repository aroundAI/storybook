'use client';

/**
 * useExportWorker — manages the WebCodecs export Worker lifecycle.
 *
 * Provides:
 * - `startExport(clips, settings, durationMs)` to begin encoding
 * - `cancelExport()` to abort
 * - Reactive state: progress%, stage, isExporting, error, resultBlob
 */

import { useCallback, useRef, useState } from 'react';

import type {
    ExportClipManifest,
    ExportSettings,
    ExportWorkerMessage,
} from '../workers/export.worker';

// ──────────────────────────────────────────
// Export state
// ──────────────────────────────────────────

export interface ExportState {
    isExporting: boolean;
    progress: number; // 0-100
    stage: 'idle' | 'decoding' | 'encoding' | 'muxing' | 'complete' | 'error';
    error: string | null;
    resultBlob: Blob | null;
    durationMs: number | null;
}

const INITIAL_STATE: ExportState = {
    isExporting: false,
    progress: 0,
    stage: 'idle',
    error: null,
    resultBlob: null,
    durationMs: null,
};

// ──────────────────────────────────────────
// Hook
// ──────────────────────────────────────────

export function useExportWorker() {
    const [state, setState] = useState<ExportState>(INITIAL_STATE);
    const workerRef = useRef<Worker | null>(null);

    const startExport = useCallback(
        (clips: ExportClipManifest[], settings: ExportSettings, totalDurationMs: number) => {
            // Reset state
            setState({
                isExporting: true,
                progress: 0,
                stage: 'encoding',
                error: null,
                resultBlob: null,
                durationMs: null,
            });

            // Terminate any existing Worker
            workerRef.current?.terminate();

            try {
                const worker = new Worker(
                    new URL('../workers/export.worker.ts', import.meta.url),
                    { type: 'module' },
                );

                workerRef.current = worker;

                worker.onmessage = (event: MessageEvent<ExportWorkerMessage>) => {
                    const msg = event.data;

                    switch (msg.type) {
                        case 'export-progress':
                            setState((prev) => ({
                                ...prev,
                                progress: msg.percent,
                                stage: msg.stage,
                            }));
                            break;

                        case 'export-complete':
                            setState({
                                isExporting: false,
                                progress: 100,
                                stage: 'complete',
                                error: null,
                                resultBlob: msg.blob,
                                durationMs: msg.durationMs,
                            });
                            worker.terminate();
                            workerRef.current = null;
                            break;

                        case 'export-error':
                            setState({
                                isExporting: false,
                                progress: 0,
                                stage: 'error',
                                error: msg.error,
                                resultBlob: null,
                                durationMs: null,
                            });
                            worker.terminate();
                            workerRef.current = null;
                            break;
                    }
                };

                worker.onerror = (err) => {
                    setState({
                        isExporting: false,
                        progress: 0,
                        stage: 'error',
                        error: err.message || 'Worker error',
                        resultBlob: null,
                        durationMs: null,
                    });
                    worker.terminate();
                    workerRef.current = null;
                };

                // Start the export
                worker.postMessage({
                    type: 'start-export',
                    clips,
                    settings,
                    totalDurationMs,
                });
            } catch (err) {
                setState({
                    isExporting: false,
                    progress: 0,
                    stage: 'error',
                    error: err instanceof Error ? err.message : 'Failed to start export',
                    resultBlob: null,
                    durationMs: null,
                });
            }
        },
        [],
    );

    const cancelExport = useCallback(() => {
        workerRef.current?.terminate();
        workerRef.current = null;
        setState(INITIAL_STATE);
    }, []);

    const downloadResult = useCallback(() => {
        if (!state.resultBlob) return;

        const url = URL.createObjectURL(state.resultBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `export_${Date.now()}.mp4`;
        a.click();
        URL.revokeObjectURL(url);
    }, [state.resultBlob]);

    return {
        exportState: state,
        startExport,
        cancelExport,
        downloadResult,
    };
}
