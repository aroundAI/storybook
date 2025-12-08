/**
 * Waveform generation utility for audio visualization
 * Uses Web Audio API to analyze audio and generate waveform data
 */

export interface WaveformGeneratorOptions {
  /** Number of data points in the waveform (default: 100) */
  samples?: number;
  /** Audio channel to analyze (default: 0 for left/mono) */
  channel?: number;
}

export interface WaveformData {
  /** Normalized amplitude data (0-1 range) */
  amplitudes: Float32Array;
  /** Audio duration in seconds */
  duration: number;
  /** Audio sample rate */
  sampleRate: number;
}

/**
 * Generates waveform data from an audio URL
 *
 * @param audioUrl - URL of the audio file to analyze
 * @param options - Configuration options
 * @returns Promise resolving to waveform data
 *
 * @example
 * ```ts
 * const waveform = await generateWaveformData('https://example.com/audio.mp3');
 * console.log(waveform.amplitudes); // Float32Array of 100 normalized values
 * console.log(waveform.duration); // Audio duration in seconds
 * ```
 */
export async function generateWaveformData(
  audioUrl: string,
  options: WaveformGeneratorOptions = {},
): Promise<WaveformData> {
  const { samples = 100, channel = 0 } = options;

  // Fetch audio data
  const response = await fetch(audioUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch audio: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();

  // Decode audio using Web Audio API
  const audioContext = new AudioContext();

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const channelData = audioBuffer.getChannelData(
      Math.min(channel, audioBuffer.numberOfChannels - 1),
    );

    // Downsample to desired number of samples
    const waveformData = downsampleAudioData(channelData, samples);

    // Normalize to 0-1 range
    normalizeAmplitudes(waveformData);

    return {
      amplitudes: waveformData,
      duration: audioBuffer.duration,
      sampleRate: audioBuffer.sampleRate,
    };
  } finally {
    // Always close the AudioContext to prevent memory leaks
    await audioContext.close();
  }
}

/**
 * Downsamples audio channel data to a specified number of samples
 * Each sample represents the average absolute amplitude of a block
 */
function downsampleAudioData(
  channelData: Float32Array,
  samples: number,
): Float32Array {
  const waveformData = new Float32Array(samples);
  const blockSize = Math.floor(channelData.length / samples);

  for (let i = 0; i < samples; i++) {
    let sum = 0;
    const startIndex = i * blockSize;

    for (let j = 0; j < blockSize; j++) {
      sum += Math.abs(channelData[startIndex + j] ?? 0);
    }

    waveformData[i] = sum / blockSize;
  }

  return waveformData;
}

/**
 * Normalizes amplitude values to 0-1 range in place
 */
function normalizeAmplitudes(data: Float32Array): void {
  let max = 0;

  // Find maximum value
  for (let i = 0; i < data.length; i++) {
    const value = data[i]!;
    if (value > max) {
      max = value;
    }
  }

  // Normalize all values
  if (max > 0) {
    for (let i = 0; i < data.length; i++) {
      data[i] = data[i]! / max;
    }
  }
}

/**
 * Formats time in seconds to MM:SS format
 *
 * @param seconds - Time in seconds
 * @returns Formatted time string
 *
 * @example
 * ```ts
 * formatTime(125); // "2:05"
 * formatTime(3661); // "61:01"
 * ```
 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }

  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);

  return `${mins}:${secs.toString().padStart(2, '0')}`;
}
