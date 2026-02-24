'use client';

/**
 * useWaveformWorker — manages a single waveform Worker instance.
 *
 * Provides a `requestPeaks(url)` function that fetches audio,
 * sends the ArrayBuffer to the Worker for decoding + peak extraction,
 * and returns the peaks via a Promise.
 *
 * The Worker is lazily created and shared across all Waveform components.
 */

import { useCallback, useRef } from 'react';

import type { WaveformWorkerResponse } from '../workers/waveform.worker';
import { waveformCache } from '../lib/lru-cache';

// ──────────────────────────────────────────
// Singleton Worker (shared across all instances)
// ──────────────────────────────────────────

let sharedWorker: Worker | null = null;
const pendingRequests = new Map<string, {
    resolve: (peaks: { peaks: Float32Array; durationMs: number }) => void;
    reject: (err: Error) => void;
}>();

function getWorker(): Worker | null {
    if (typeof window === 'undefined') return null;

    if (!sharedWorker) {
        try {
            sharedWorker = new Worker(
                new URL('../workers/waveform.worker.ts', import.meta.url),
                { type: 'module' },
            );

            sharedWorker.onmessage = (event: MessageEvent<WaveformWorkerResponse>) => {
                const msg = event.data;
                const pending = pendingRequests.get(msg.id);
                if (!pending) return;

                pendingRequests.delete(msg.id);

                if (msg.type === 'peaks-ready') {
                    pending.resolve({ peaks: msg.peaks, durationMs: msg.durationMs });
                } else if (msg.type === 'peaks-error') {
                    pending.reject(new Error(msg.error));
                }
            };

            sharedWorker.onerror = () => {
                // Worker failed to load — fall back to main-thread decoding
                sharedWorker = null;
            };
        } catch {
            // Worker not supported or failed to initialize
            return null;
        }
    }

    return sharedWorker;
}

// ──────────────────────────────────────────
// Hook
// ──────────────────────────────────────────

export function useWaveformWorker() {
    const idCounterRef = useRef(0);

    /**
     * Request peak extraction for a media URL.
     * Returns high-resolution peaks (~1 per ms) from cache or Worker.
     */
    const requestPeaks = useCallback(
        async (mediaUrl: string): Promise<{ peaks: Float32Array; durationMs: number } | null> => {
            // Check LRU cache first
            const cached = waveformCache.get(mediaUrl);
            if (cached) {
                return { peaks: cached, durationMs: cached.length };
            }

            const worker = getWorker();

            // Fetch the audio data on main thread (Worker can't do cross-origin fetch without CORS issues)
            let audioData: ArrayBuffer;
            try {
                const response = await fetch(mediaUrl);
                audioData = await response.arrayBuffer();
            } catch {
                return null;
            }

            // If Worker is available, offload decoding + peak extraction
            if (worker) {
                const id = `wf-${++idCounterRef.current}`;

                return new Promise<{ peaks: Float32Array; durationMs: number } | null>((resolve, reject) => {
                    pendingRequests.set(id, {
                        resolve: (result) => {
                            waveformCache.set(mediaUrl, result.peaks);
                            resolve(result);
                        },
                        reject,
                    });

                    // Transfer the ArrayBuffer (zero-copy to Worker)
                    worker.postMessage(
                        { type: 'extract-peaks', id, audioData },
                        [audioData],
                    );
                });
            }

            // Fallback: decode on main thread
            try {
                const ctx = new OfflineAudioContext(1, 1, 44100);
                const buffer = await ctx.decodeAudioData(audioData);
                const totalBuckets = Math.min(Math.ceil(buffer.duration * 1000), 50_000);
                const channelData = buffer.getChannelData(0);
                const peaks = extractPeaksFallback(channelData, totalBuckets);
                const durationMs = buffer.duration * 1000;
                waveformCache.set(mediaUrl, peaks);
                return { peaks, durationMs };
            } catch {
                return null;
            }
        },
        [],
    );

    return { requestPeaks };
}

// ──────────────────────────────────────────
// Fallback peak extraction (main thread)
// ──────────────────────────────────────────

function extractPeaksFallback(channelData: Float32Array, bucketCount: number): Float32Array {
    const peaks = new Float32Array(bucketCount);
    const samplesPerBucket = Math.floor(channelData.length / bucketCount);

    if (samplesPerBucket < 1) {
        for (let i = 0; i < Math.min(channelData.length, bucketCount); i++) {
            peaks[i] = Math.abs(channelData[i]!);
        }
        return peaks;
    }

    for (let bucket = 0; bucket < bucketCount; bucket++) {
        let max = 0;
        const start = bucket * samplesPerBucket;
        const end = Math.min(start + samplesPerBucket, channelData.length);

        for (let j = start; j < end; j++) {
            const abs = Math.abs(channelData[j]!);
            if (abs > max) max = abs;
        }

        peaks[bucket] = max;
    }

    return peaks;
}
