/**
 * Waveform Worker — off-main-thread audio peak extraction.
 *
 * Receives an ArrayBuffer of audio data, decodes it via OfflineAudioContext,
 * extracts peak amplitudes at ~1 peak per ms resolution, and posts the
 * Float32Array back to the main thread.
 *
 * This avoids blocking the main thread during audio decoding and peak
 * computation for long audio clips.
 */

// ──────────────────────────────────────────
// Message types
// ──────────────────────────────────────────

interface ExtractPeaksRequest {
  type: 'extract-peaks';
  id: string;
  audioData: ArrayBuffer;
}

type WorkerMessage = ExtractPeaksRequest;

interface ExtractPeaksResponse {
  type: 'peaks-ready';
  id: string;
  peaks: Float32Array;
  durationMs: number;
}

interface ExtractPeaksError {
  type: 'peaks-error';
  id: string;
  error: string;
}

export type WaveformWorkerResponse = ExtractPeaksResponse | ExtractPeaksError;

// ──────────────────────────────────────────
// Peak extraction (same algo as main thread, but runs in Worker)
// ──────────────────────────────────────────

function extractPeaks(
  channelData: Float32Array,
  bucketCount: number,
): Float32Array {
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

// ──────────────────────────────────────────
// Worker message handler
// ──────────────────────────────────────────

const MAX_PEAK_BUCKETS = 50_000;

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  const msg = event.data;

  if (msg.type === 'extract-peaks') {
    try {
      // Decode audio in the Worker via OfflineAudioContext
      const ctx = new OfflineAudioContext(1, 1, 44100);
      const buffer = await ctx.decodeAudioData(msg.audioData);

      // Extract peaks at ~1 peak per ms
      const totalBuckets = Math.min(
        Math.ceil(buffer.duration * 1000),
        MAX_PEAK_BUCKETS,
      );
      const channelData = buffer.getChannelData(0);
      const peaks = extractPeaks(channelData, totalBuckets);
      const durationMs = buffer.duration * 1000;

      // Transfer the Float32Array buffer (zero-copy)
      const response: ExtractPeaksResponse = {
        type: 'peaks-ready',
        id: msg.id,
        peaks,
        durationMs,
      };
      (self as unknown as Worker).postMessage(response, [peaks.buffer]);
    } catch (err) {
      const response: ExtractPeaksError = {
        type: 'peaks-error',
        id: msg.id,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
      (self as unknown as Worker).postMessage(response);
    }
  }
};
