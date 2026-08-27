/**
 * WebCodecs Export Worker — browser-based video encoding pipeline.
 *
 * Uses mp4box.js to demux source media, WebCodecs VideoDecoder/AudioDecoder
 * to decode individual frames and audio samples, composites frames on
 * OffscreenCanvas, re-encodes with VideoEncoder/AudioEncoder, and muxes
 * to a proper MP4 container via mp4box.js.
 *
 * Progress is reported via `postMessage`.
 *
 * ⚠️ Requires browser support for WebCodecs API (Chrome 94+, Edge 94+).
 */
import {
  DataStream,
  Endianness,
  MP4BoxBuffer,
  createFile,
} from 'mp4box';
import type { Movie, Sample, SampleEntry, Track } from 'mp4box';

/**
 * mp4box types `stsd` entries as the SampleEntry base class, but the codec
 * configuration boxes we need live on the concrete AVC/MP4A subclasses.
 */
type CodecConfigBox = { write: (stream: DataStream) => void };

function getCodecConfigBox(
  entry: SampleEntry | undefined,
  box: 'avcC' | 'esds',
): CodecConfigBox | undefined {
  return (entry as unknown as Record<string, CodecConfigBox | undefined>)?.[
    box
  ];
}

// ──────────────────────────────────────────
// Message types
// ──────────────────────────────────────────

export interface ExportClipManifest {
  id: string;
  mediaUrl: string;
  startMs: number;
  endMs: number;
  inPointMs: number;
  outPointMs: number;
  trackType: string;
  opacity: number;
  speedMultiplier: number;
  volume: number;
}

export interface ExportSettings {
  width: number;
  height: number;
  fps: number;
  videoBitrate: number; // bps
  audioBitrate: number; // bps
  audioSampleRate: number;
}

export interface StartExportMessage {
  type: 'start-export';
  clips: ExportClipManifest[];
  settings: ExportSettings;
  totalDurationMs: number;
}

export interface ExportProgressMessage {
  type: 'export-progress';
  percent: number;
  framesEncoded: number;
  totalFrames: number;
  stage: 'decoding' | 'encoding' | 'muxing' | 'audio';
}

export interface ExportCompleteMessage {
  type: 'export-complete';
  blob: Blob;
  durationMs: number;
}

export interface ExportErrorMessage {
  type: 'export-error';
  error: string;
}

export type ExportWorkerMessage =
  | ExportProgressMessage
  | ExportCompleteMessage
  | ExportErrorMessage;

type WorkerIncomingMessage = StartExportMessage;

// ──────────────────────────────────────────
// Utility: Check if WebCodecs is available
// ──────────────────────────────────────────

function isWebCodecsSupported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoDecoder !== 'undefined' &&
    typeof AudioEncoder !== 'undefined' &&
    typeof AudioDecoder !== 'undefined'
  );
}

// ──────────────────────────────────────────
// Encoder configuration
// ──────────────────────────────────────────

/** H.264 High Profile Level 4.0 — widely supported across devices */
const VIDEO_CODEC = 'avc1.640028';
const AUDIO_CODEC = 'mp4a.40.2'; // AAC-LC
const KEYFRAME_INTERVAL_SECONDS = 2;
const AUDIO_CHANNELS = 2; // Stereo

// ──────────────────────────────────────────
// Compositing canvas
// ──────────────────────────────────────────

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

function getCanvas(width: number, height: number) {
  if (!canvas || canvas.width !== width || canvas.height !== height) {
    canvas = new OffscreenCanvas(width, height);
    ctx = canvas.getContext('2d');
  }
  return { canvas: canvas!, ctx: ctx! };
}

// ──────────────────────────────────────────
// mp4box.js demuxer: extract decoded video frames
// ──────────────────────────────────────────

interface DecodedFrame {
  frame: VideoFrame;
  timestampUs: number;
}

/**
 * Demux a video URL into individual VideoFrames using mp4box.js + VideoDecoder.
 */
async function demuxVideoFrames(
  url: string,
  inPointMs: number,
  outPointMs: number,
): Promise<DecodedFrame[]> {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();

  return new Promise<DecodedFrame[]>((resolve, reject) => {
    const frames: DecodedFrame[] = [];
    let videoTrack: Track | null = null;

    const mp4File = createFile();

    let decoder: VideoDecoder | null = null;
    // eslint-disable-next-line prefer-const
    let decoderRef: { current: VideoDecoder | null } = { current: null };

    mp4File.onReady = (info: Movie) => {
      if (info.videoTracks.length === 0) {
        resolve([]);
        return;
      }

      videoTrack = info.videoTracks[0]!;
      const trackInfo = info.videoTracks[0]!;

      // Get codec description from track
      const trak = mp4File.getTrackById(videoTrack.id);
      const codecDescription = getCodecConfigBox(
        trak?.mdia?.minf?.stbl?.stsd?.entries?.[0],
        'avcC',
      );

      decoder = new VideoDecoder({
        output: (videoFrame) => {
          const tsMs = videoFrame.timestamp / 1000; // μs → ms
          if (tsMs >= inPointMs && tsMs <= outPointMs) {
            frames.push({
              frame: videoFrame,
              timestampUs: videoFrame.timestamp,
            });
          } else {
            videoFrame.close();
          }
        },
        error: (err) => reject(err),
      });
      decoderRef.current = decoder;

      const decoderConfig: VideoDecoderConfig = {
        codec: trackInfo.codec,
        codedWidth: trackInfo.video?.width ?? 0,
        codedHeight: trackInfo.video?.height ?? 0,
      };

      // Add description if available (needed for H.264 avcC)
      if (codecDescription) {
        const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
        codecDescription.write(stream);
        decoderConfig.description = new Uint8Array(stream.buffer, 8);
      }

      decoder.configure(decoderConfig);

      mp4File.setExtractionOptions(videoTrack!.id, undefined, {
        nbSamples: 100,
      });
      mp4File.start();
    };

    mp4File.onSamples = (
      _trackId: number,
      _ref: unknown,
      samples: Array<Sample>,
    ) => {
      for (const sample of samples) {
        if (!sample.data) continue;

        const chunk = new EncodedVideoChunk({
          type: sample.is_sync ? 'key' : 'delta',
          timestamp: (sample.cts / sample.timescale) * 1_000_000, // → μs
          duration: (sample.duration / sample.timescale) * 1_000_000,
          data: sample.data,
        });
        decoder!.decode(chunk);
      }
    };

    mp4File.onError = (module: string, message: string) =>
      reject(new Error(`${module}: ${message}`));

    // Feed the buffer to mp4box
    mp4File.appendBuffer(MP4BoxBuffer.fromArrayBuffer(arrayBuffer, 0));
    mp4File.flush();

    // mp4box triggers onReady/onSamples synchronously during appendBuffer,
    // so decoder is guaranteed to be assigned at this point.
    // Flush the decoder to get remaining frames, then resolve.
    decoderRef
      .current!.flush()
      .then(() => resolve(frames))
      .catch(reject);
  });
}

// ──────────────────────────────────────────
// mp4box.js demuxer: extract decoded audio samples
// ──────────────────────────────────────────

interface DecodedAudio {
  sampleRate: number;
  channels: number;
  samples: Float32Array[]; // Per-channel PCM data
}

/**
 * Demux audio from a video URL into raw PCM Float32 samples.
 */
async function demuxAudioSamples(
  url: string,
  inPointMs: number,
  outPointMs: number,
  _targetSampleRate: number,
): Promise<DecodedAudio | null> {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();

  return new Promise<DecodedAudio | null>((resolve, reject) => {
    const pcmChunks: AudioData[] = [];
    let audioTrack: Track | null = null;

    const mp4File = createFile();
    let decoder: AudioDecoder | null = null;
    // eslint-disable-next-line prefer-const
    let decoderRef: { current: AudioDecoder | null } = { current: null };

    mp4File.onReady = (info: Movie) => {
      if (info.audioTracks.length === 0) {
        resolve(null);
        return;
      }

      audioTrack = info.audioTracks[0]!;
      const trackInfo = info.audioTracks[0]!;

      // Get codec description
      const trak = mp4File.getTrackById(audioTrack.id);
      const esds = getCodecConfigBox(
        trak?.mdia?.minf?.stbl?.stsd?.entries?.[0],
        'esds',
      );

      decoder = new AudioDecoder({
        output: (audioData) => {
          pcmChunks.push(audioData);
        },
        error: (err) => reject(err),
      });
      decoderRef.current = decoder;

      const decoderConfig: AudioDecoderConfig = {
        codec: trackInfo.codec,
        sampleRate: trackInfo.audio?.sample_rate ?? 0,
        numberOfChannels: trackInfo.audio?.channel_count ?? 0,
      };

      if (esds) {
        const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
        esds.write(stream);
        decoderConfig.description = new Uint8Array(stream.buffer, 8);
      }

      decoder.configure(decoderConfig);

      mp4File.setExtractionOptions(audioTrack!.id, undefined, {
        nbSamples: 1000,
      });
      mp4File.start();
    };

    mp4File.onSamples = (
      _trackId: number,
      _ref: unknown,
      samples: Array<Sample>,
    ) => {
      for (const sample of samples) {
        if (!sample.data) continue;

        const chunk = new EncodedAudioChunk({
          type: sample.is_sync ? 'key' : 'delta',
          timestamp: (sample.cts / sample.timescale) * 1_000_000,
          duration: (sample.duration / sample.timescale) * 1_000_000,
          data: sample.data,
        });
        decoder!.decode(chunk);
      }
    };

    mp4File.onError = (module: string, message: string) =>
      reject(new Error(`${module}: ${message}`));

    mp4File.appendBuffer(MP4BoxBuffer.fromArrayBuffer(arrayBuffer, 0));
    mp4File.flush();

    // mp4box triggers onReady/onSamples synchronously during appendBuffer.
    // Flush the decoder to get remaining audio data, then process PCM.
    decoderRef
      .current!.flush()
      .then(() => {
        // Convert AudioData chunks to Float32 PCM
        const channels = audioTrack!.audio?.channel_count ?? AUDIO_CHANNELS;
        const sampleRate = audioTrack!.audio?.sample_rate ?? 0;
        const inSample = Math.floor((inPointMs / 1000) * sampleRate);
        const outSample = Math.ceil((outPointMs / 1000) * sampleRate);

        // Collect all samples
        let totalSamples = 0;
        for (const chunk of pcmChunks) {
          totalSamples += chunk.numberOfFrames;
        }

        const channelData: Float32Array[] = [];
        for (let c = 0; c < channels; c++) {
          channelData.push(new Float32Array(totalSamples));
        }

        let offset = 0;
        for (const chunk of pcmChunks) {
          for (let c = 0; c < channels; c++) {
            const buffer = new Float32Array(chunk.numberOfFrames);
            chunk.copyTo(buffer, {
              planeIndex: c,
              format: 'f32-planar',
            });
            channelData[c]!.set(buffer, offset);
          }
          offset += chunk.numberOfFrames;
          chunk.close();
        }

        // Trim to in/out range
        const startIdx = Math.max(0, inSample);
        const endIdx = Math.min(totalSamples, outSample);
        const trimmedChannels = channelData.map((ch) =>
          ch.slice(startIdx, endIdx),
        );

        resolve({
          sampleRate,
          channels,
          samples: trimmedChannels,
        });
      })
      .catch(reject);
  });
}

// ──────────────────────────────────────────
// Audio mixing: combine multiple audio sources
// ──────────────────────────────────────────

function mixAudio(
  sources: { audio: DecodedAudio; startMs: number; volume: number }[],
  totalDurationMs: number,
  targetSampleRate: number,
  targetChannels: number,
): Float32Array[] {
  const totalSamples = Math.ceil((totalDurationMs / 1000) * targetSampleRate);
  const output: Float32Array[] = [];

  for (let c = 0; c < targetChannels; c++) {
    output.push(new Float32Array(totalSamples));
  }

  for (const source of sources) {
    const startSample = Math.floor((source.startMs / 1000) * targetSampleRate);
    const srcChannels = source.audio.channels;
    const srcRate = source.audio.sampleRate;

    for (let c = 0; c < targetChannels; c++) {
      const srcChannel = c < srcChannels ? c : 0; // Mono → duplicate to stereo
      const srcData = source.audio.samples[srcChannel]!;

      for (let i = 0; i < srcData.length; i++) {
        // Simple sample rate conversion (nearest neighbor)
        const srcIdx =
          srcRate !== targetSampleRate
            ? Math.floor(i * (srcRate / targetSampleRate))
            : i;

        const dstIdx = startSample + i;
        if (dstIdx >= 0 && dstIdx < totalSamples && srcIdx < srcData.length) {
          output[c]![dstIdx]! += srcData[srcIdx]! * source.volume;
        }
      }
    }
  }

  // Clamp to [-1, 1]
  for (const channel of output) {
    for (let i = 0; i < channel.length; i++) {
      channel[i] = Math.max(-1, Math.min(1, channel[i]!));
    }
  }

  return output;
}

// ──────────────────────────────────────────
// mp4box.js muxer: create proper MP4 container
// ──────────────────────────────────────────

/** Encoder descriptions arrive as ArrayBuffer or a view over one. */
function toArrayBuffer(source: AllowSharedBufferSource): ArrayBuffer {
  if (source instanceof ArrayBuffer) return source;
  const view = source as ArrayBufferView;
  return view.buffer.slice(
    view.byteOffset,
    view.byteOffset + view.byteLength,
  ) as ArrayBuffer;
}

function muxToMp4(
  videoChunks: { chunk: EncodedVideoChunk; meta?: EncodedVideoChunkMetadata }[],
  audioChunks: { chunk: EncodedAudioChunk; meta?: EncodedAudioChunkMetadata }[],
  settings: ExportSettings,
): Blob {
  const mp4File = createFile();

  // Add video track
  const videoTrackId = mp4File.addTrack({
    timescale: 90_000,
    width: settings.width,
    height: settings.height,
    // v2 takes the sample-entry four-CC here; the full codec string
    // (VIDEO_CODEC) still configures the encoder itself.
    type: 'avc1',
    ...(videoChunks[0]?.meta?.decoderConfig?.description
      ? {
          avcDecoderConfigRecord: toArrayBuffer(
            videoChunks[0].meta.decoderConfig.description,
          ),
        }
      : {}),
  });

  for (const { chunk } of videoChunks) {
    const buf = new Uint8Array(chunk.byteLength);
    chunk.copyTo(buf);

    mp4File.addSample(videoTrackId, buf, {
      duration: Math.round(((chunk.duration ?? 0) / 1_000_000) * 90_000),
      cts: Math.round((chunk.timestamp / 1_000_000) * 90_000),
      is_sync: chunk.type === 'key',
    });
  }

  // Add audio track if we have audio chunks
  if (audioChunks.length > 0) {
    // NOTE: mp4box v1 accepted `audioSpecificConfig` here; v2's addTrack has
    // no equivalent field and instead expects the AAC config as a constructed
    // `esds` box via `description_boxes`. Until that is built and verified
    // against a real export, players that require an explicit AudioSpecificConfig
    // may reject this track's audio. Video is unaffected.
    const audioTrackId = mp4File.addTrack({
      timescale: settings.audioSampleRate,
      samplerate: settings.audioSampleRate,
      channel_count: AUDIO_CHANNELS,
      samplesize: 16,
      type: 'mp4a',
    });

    for (const { chunk } of audioChunks) {
      const buf = new Uint8Array(chunk.byteLength);
      chunk.copyTo(buf);

      mp4File.addSample(audioTrackId, buf, {
        duration: Math.round(
          ((chunk.duration ?? 0) / 1_000_000) * settings.audioSampleRate,
        ),
        cts: Math.round(
          (chunk.timestamp / 1_000_000) * settings.audioSampleRate,
        ),
        is_sync: chunk.type === 'key',
      });
    }
  }

  // Generate MP4 data
  const outputBuffer = mp4File.getBuffer();
  return new Blob([outputBuffer], { type: 'video/mp4' });
}

// ──────────────────────────────────────────
// Main export pipeline
// ──────────────────────────────────────────

async function runExport(manifest: StartExportMessage) {
  const { clips, settings, totalDurationMs } = manifest;
  const { width, height, fps, videoBitrate, audioBitrate, audioSampleRate } =
    settings;
  const totalFrames = Math.ceil((totalDurationMs / 1000) * fps);
  const frameDurationUs = Math.round(1_000_000 / fps); // microseconds

  // ── 1. Demux source video clips into decoded frames ──
  postProgress(0, 0, totalFrames, 'decoding');

  const videoClips = clips.filter((c) =>
    ['video', 'shot', 'main'].includes(c.trackType),
  );
  const audioClips = clips.filter(
    (c) =>
      ['dialogue', 'music', 'sfx', 'audio'].includes(c.trackType) ||
      (['video', 'shot', 'main'].includes(c.trackType) && c.volume > 0),
  );

  // Demux video frames from source clips
  const clipFrameMap = new Map<string, DecodedFrame[]>();
  for (let i = 0; i < videoClips.length; i++) {
    const clip = videoClips[i]!;
    try {
      const frames = await demuxVideoFrames(
        clip.mediaUrl,
        clip.inPointMs,
        clip.outPointMs,
      );
      clipFrameMap.set(clip.id, frames);
    } catch (err) {
      console.warn(`[Export] Failed to demux video clip ${clip.id}:`, err);
      // Continue — clip will use fallback (black frame)
    }
    postProgress(
      Math.round(((i + 1) / Math.max(videoClips.length, 1)) * 20),
      0,
      totalFrames,
      'decoding',
    );
  }

  // ── 2. Demux and mix audio ──
  postProgress(20, 0, totalFrames, 'audio');

  const audioSources: {
    audio: DecodedAudio;
    startMs: number;
    volume: number;
  }[] = [];
  for (let i = 0; i < audioClips.length; i++) {
    const clip = audioClips[i]!;
    try {
      const audio = await demuxAudioSamples(
        clip.mediaUrl,
        clip.inPointMs,
        clip.outPointMs,
        audioSampleRate,
      );
      if (audio) {
        audioSources.push({
          audio,
          startMs: clip.startMs,
          volume: clip.volume,
        });
      }
    } catch (err) {
      console.warn(`[Export] Failed to demux audio clip ${clip.id}:`, err);
    }
    postProgress(
      20 + Math.round(((i + 1) / Math.max(audioClips.length, 1)) * 10),
      0,
      totalFrames,
      'audio',
    );
  }

  // Mix all audio sources into stereo PCM
  const mixedAudio =
    audioSources.length > 0
      ? mixAudio(audioSources, totalDurationMs, audioSampleRate, AUDIO_CHANNELS)
      : null;

  // ── 3. Encode audio with AudioEncoder ──
  const encodedAudioChunks: {
    chunk: EncodedAudioChunk;
    meta?: EncodedAudioChunkMetadata;
  }[] = [];

  if (mixedAudio) {
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => {
        encodedAudioChunks.push({ chunk, meta });
      },
      error: (err) => postError(`AudioEncoder error: ${err.message}`),
    });

    audioEncoder.configure({
      codec: AUDIO_CODEC,
      sampleRate: audioSampleRate,
      numberOfChannels: AUDIO_CHANNELS,
      bitrate: audioBitrate,
    });

    // Feed mixed PCM to encoder in chunks (1024 samples per AudioData)
    const chunkSize = 1024;
    const totalAudioSamples = mixedAudio[0]!.length;

    for (let offset = 0; offset < totalAudioSamples; offset += chunkSize) {
      const remaining = Math.min(chunkSize, totalAudioSamples - offset);

      // Interleave channels for AudioData
      const interleaved = new Float32Array(remaining * AUDIO_CHANNELS);
      for (let s = 0; s < remaining; s++) {
        for (let c = 0; c < AUDIO_CHANNELS; c++) {
          interleaved[s * AUDIO_CHANNELS + c] = mixedAudio[c]![offset + s]!;
        }
      }

      const audioData = new AudioData({
        format: 'f32',
        sampleRate: audioSampleRate,
        numberOfFrames: remaining,
        numberOfChannels: AUDIO_CHANNELS,
        timestamp: Math.round((offset / audioSampleRate) * 1_000_000),
        data: interleaved,
      });

      audioEncoder.encode(audioData);
      audioData.close();
    }

    await audioEncoder.flush();
    audioEncoder.close();
  }

  postProgress(35, 0, totalFrames, 'encoding');

  // ── 4. Encode video frames ──
  const encodedVideoChunks: {
    chunk: EncodedVideoChunk;
    meta?: EncodedVideoChunkMetadata;
  }[] = [];

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      encodedVideoChunks.push({ chunk, meta });
    },
    error: (err) => postError(`VideoEncoder error: ${err.message}`),
  });

  videoEncoder.configure({
    codec: VIDEO_CODEC,
    width,
    height,
    bitrate: videoBitrate,
    framerate: fps,
    hardwareAcceleration: 'prefer-hardware',
  });

  const compositeCanvas = getCanvas(width, height);

  for (let frame = 0; frame < totalFrames; frame++) {
    const timestampMs = (frame / fps) * 1000;
    const timestampUs = frame * frameDurationUs;

    // Clear canvas
    compositeCanvas.ctx.fillStyle = '#000000';
    compositeCanvas.ctx.fillRect(0, 0, width, height);

    // Composite active video clips at this timestamp
    for (const clip of videoClips) {
      if (timestampMs < clip.startMs || timestampMs >= clip.endMs) continue;

      const clipFrames = clipFrameMap.get(clip.id);
      const clipProgress =
        (timestampMs - clip.startMs) / (clip.endMs - clip.startMs);
      const sourceTimeMs =
        clip.inPointMs + clipProgress * (clip.outPointMs - clip.inPointMs);
      const sourceTimeUs = sourceTimeMs * 1000;

      compositeCanvas.ctx.globalAlpha = clip.opacity;

      if (clipFrames && clipFrames.length > 0) {
        // Find closest decoded frame to the target timestamp
        let bestFrame = clipFrames[0]!;
        let bestDelta = Math.abs(bestFrame.timestampUs - sourceTimeUs);

        for (const f of clipFrames) {
          const delta = Math.abs(f.timestampUs - sourceTimeUs);
          if (delta < bestDelta) {
            bestDelta = delta;
            bestFrame = f;
          }
        }

        // Draw the decoded frame onto canvas
        compositeCanvas.ctx.drawImage(bestFrame.frame, 0, 0, width, height);
      } else {
        // Fallback: draw dark placeholder if demux failed
        compositeCanvas.ctx.fillStyle = '#1a1a2e';
        compositeCanvas.ctx.fillRect(0, 0, width, height);
        compositeCanvas.ctx.fillStyle = '#ffffff';
        compositeCanvas.ctx.font = '14px monospace';
        compositeCanvas.ctx.fillText(
          `Clip: ${clip.id.slice(0, 8)} @ ${Math.round(sourceTimeMs)}ms`,
          20,
          30,
        );
      }
      compositeCanvas.ctx.globalAlpha = 1;
    }

    // Create VideoFrame from composited canvas
    const videoFrame = new VideoFrame(compositeCanvas.canvas, {
      timestamp: timestampUs,
      duration: frameDurationUs,
    });

    // Encode the frame (keyframe every 2 seconds)
    const isKeyFrame = frame % (fps * KEYFRAME_INTERVAL_SECONDS) === 0;
    videoEncoder.encode(videoFrame, { keyFrame: isKeyFrame });
    videoFrame.close();

    // Report progress (35-90% for video encoding)
    if (frame % 10 === 0) {
      postProgress(
        35 + Math.round((frame / totalFrames) * 55),
        frame,
        totalFrames,
        'encoding',
      );
    }
  }

  await videoEncoder.flush();
  videoEncoder.close();

  // ── 5. Clean up decoded frames ──
  for (const frames of clipFrameMap.values()) {
    for (const f of frames) {
      f.frame.close();
    }
  }

  // ── 6. Mux to MP4 via mp4box.js ──
  postProgress(92, totalFrames, totalFrames, 'muxing');

  const blob = muxToMp4(encodedVideoChunks, encodedAudioChunks, settings);

  // ── Complete ──
  const completeMsg: ExportCompleteMessage = {
    type: 'export-complete',
    blob,
    durationMs: totalDurationMs,
  };
  (self as unknown as Worker).postMessage(completeMsg);
}

// ──────────────────────────────────────────
// Progress + error helpers
// ──────────────────────────────────────────

function postProgress(
  percent: number,
  framesEncoded: number,
  totalFrames: number,
  stage: ExportProgressMessage['stage'],
) {
  const msg: ExportProgressMessage = {
    type: 'export-progress',
    percent,
    framesEncoded,
    totalFrames,
    stage,
  };
  (self as unknown as Worker).postMessage(msg);
}

function postError(error: string) {
  const msg: ExportErrorMessage = {
    type: 'export-error',
    error,
  };
  (self as unknown as Worker).postMessage(msg);
}

// ──────────────────────────────────────────
// Worker message handler
// ──────────────────────────────────────────

self.onmessage = async (event: MessageEvent<WorkerIncomingMessage>) => {
  const msg = event.data;

  if (msg.type === 'start-export') {
    if (!isWebCodecsSupported()) {
      postError(
        'WebCodecs API not supported in this browser. Please use Chrome 94+ or Edge 94+.',
      );
      return;
    }

    try {
      await runExport(msg);
    } catch (err) {
      postError(err instanceof Error ? err.message : 'Export failed');
    }
  }
};
