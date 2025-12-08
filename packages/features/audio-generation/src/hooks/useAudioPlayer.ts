'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { type WaveformData, generateWaveformData } from '../lib/audio';

export interface UseAudioPlayerOptions {
  /** URL of the audio file to play */
  audioUrl: string;
  /** Whether to start playing automatically when loaded */
  autoPlay?: boolean;
  /** Callback when playback starts */
  onPlay?: () => void;
  /** Callback when playback pauses */
  onPause?: () => void;
  /** Callback when playback ends */
  onEnded?: () => void;
  /** Callback when an error occurs */
  onError?: (error: Error) => void;
  /** Whether to generate waveform data (default: true) */
  generateWaveform?: boolean;
}

interface AudioPlayerState {
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  isBuffering: boolean;
  isLoading: boolean;
  isPlaying: boolean;
  error: Error | null;
  waveformData: WaveformData | null;
}

export interface UseAudioPlayerReturn {
  // State
  currentTime: number;
  duration: number;
  volume: number;
  isMuted: boolean;
  isBuffering: boolean;
  isLoading: boolean;
  isPlaying: boolean;
  error: Error | null;
  waveformData: WaveformData | null;

  // Actions
  play: () => Promise<void>;
  pause: () => void;
  togglePlay: () => Promise<void>;
  seek: (time: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;

  // Refs
  audioRef: React.RefObject<HTMLAudioElement | null>;
}

const initialState: AudioPlayerState = {
  currentTime: 0,
  duration: 0,
  volume: 1,
  isMuted: false,
  isBuffering: false,
  isLoading: true,
  isPlaying: false,
  error: null,
  waveformData: null,
};

/**
 * Custom hook for audio playback with waveform visualization support
 *
 * @param options - Configuration options for the audio player
 * @returns Audio player state and control functions
 *
 * @example
 * ```tsx
 * const {
 *   currentTime,
 *   duration,
 *   isPlaying,
 *   play,
 *   pause,
 *   seek,
 *   waveformData,
 * } = useAudioPlayer({
 *   audioUrl: 'https://example.com/audio.mp3',
 *   onPlay: () => console.log('Started playing'),
 *   onEnded: () => console.log('Finished playing'),
 * });
 * ```
 */
export function useAudioPlayer(
  options: UseAudioPlayerOptions,
): UseAudioPlayerReturn {
  const {
    audioUrl,
    autoPlay,
    onPlay,
    onPause,
    onEnded,
    onError,
    generateWaveform = true,
  } = options;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previousVolumeRef = useRef<number>(1);
  const [state, setState] = useState<AudioPlayerState>(initialState);

  // Create and set up audio element
  useEffect(() => {
    const audio = new Audio();
    audioRef.current = audio;

    audio.preload = 'metadata';
    audio.src = audioUrl;

    // Event handlers
    const handleLoadedMetadata = () => {
      setState((prev) => ({
        ...prev,
        duration: audio.duration,
        isLoading: false,
      }));

      if (autoPlay) {
        audio.play().catch((err) => {
          setState((prev) => ({
            ...prev,
            error: err instanceof Error ? err : new Error('Playback failed'),
          }));
        });
      }
    };

    const handleTimeUpdate = () => {
      setState((prev) => ({
        ...prev,
        currentTime: audio.currentTime,
      }));
    };

    const handlePlay = () => {
      setState((prev) => ({
        ...prev,
        isPlaying: true,
        isBuffering: false,
      }));
      onPlay?.();
    };

    const handlePause = () => {
      setState((prev) => ({
        ...prev,
        isPlaying: false,
      }));
      onPause?.();
    };

    const handleEnded = () => {
      setState((prev) => ({
        ...prev,
        isPlaying: false,
        currentTime: 0,
      }));
      onEnded?.();
    };

    const handleWaiting = () => {
      setState((prev) => ({
        ...prev,
        isBuffering: true,
      }));
    };

    const handlePlaying = () => {
      setState((prev) => ({
        ...prev,
        isBuffering: false,
      }));
    };

    const handleError = () => {
      const errorCode = audio.error?.code;
      let errorMessage = 'Unknown playback error';

      switch (errorCode) {
        case MediaError.MEDIA_ERR_NETWORK:
          errorMessage = 'Network error loading audio';
          break;
        case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
          errorMessage = 'Audio format not supported';
          break;
        case MediaError.MEDIA_ERR_DECODE:
          errorMessage = 'Error decoding audio';
          break;
      }

      const error = new Error(errorMessage);
      setState((prev) => ({
        ...prev,
        error,
        isLoading: false,
      }));
      onError?.(error);
    };

    // Add event listeners
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('error', handleError);

    // Cleanup function
    return () => {
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('error', handleError);

      audio.pause();
      audio.src = '';
      audio.load();
      audioRef.current = null;
    };
  }, [audioUrl, autoPlay, onPlay, onPause, onEnded, onError]);

  // Generate waveform data
  useEffect(() => {
    if (!generateWaveform || !audioUrl) return;

    let cancelled = false;

    const loadWaveform = async () => {
      try {
        const waveformData = await generateWaveformData(audioUrl);
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            waveformData,
          }));
        }
      } catch (err) {
        // Waveform generation failure is non-critical, just log it
        // Note: Using console.warn here because this is a client-side hook
        // and the structured logger (getLogger) is async/server-side only
        console.warn('Failed to generate waveform:', err);
      }
    };

    loadWaveform();

    return () => {
      cancelled = true;
    };
  }, [audioUrl, generateWaveform]);

  // Play function
  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;

    try {
      await audio.play();
    } catch (err) {
      setState((prev) => ({
        ...prev,
        error: err instanceof Error ? err : new Error('Playback failed'),
      }));
    }
  }, []);

  // Pause function
  const pause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    audio.pause();
  }, []);

  // Toggle play/pause
  const togglePlay = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      await play();
    } else {
      pause();
    }
  }, [play, pause]);

  // Seek function
  const seek = useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    const clampedTime = Math.max(0, Math.min(time, audio.duration || 0));
    audio.currentTime = clampedTime;
    setState((prev) => ({
      ...prev,
      currentTime: clampedTime,
    }));
  }, []);

  // Set volume function
  const setVolume = useCallback((volume: number) => {
    const audio = audioRef.current;
    if (!audio) return;

    const clampedVolume = Math.max(0, Math.min(1, volume));
    audio.volume = clampedVolume;
    previousVolumeRef.current = clampedVolume;
    setState((prev) => ({
      ...prev,
      volume: clampedVolume,
      isMuted: clampedVolume === 0,
    }));
  }, []);

  // Toggle mute function
  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (state.isMuted) {
      // Unmute - restore previous volume
      const volumeToRestore =
        previousVolumeRef.current > 0 ? previousVolumeRef.current : 1;
      audio.volume = volumeToRestore;
      setState((prev) => ({
        ...prev,
        volume: volumeToRestore,
        isMuted: false,
      }));
    } else {
      // Mute - save current volume and set to 0
      previousVolumeRef.current = state.volume;
      audio.volume = 0;
      setState((prev) => ({
        ...prev,
        volume: 0,
        isMuted: true,
      }));
    }
  }, [state.isMuted, state.volume]);

  return {
    // State
    currentTime: state.currentTime,
    duration: state.duration,
    volume: state.volume,
    isMuted: state.isMuted,
    isBuffering: state.isBuffering,
    isLoading: state.isLoading,
    isPlaying: state.isPlaying,
    error: state.error,
    waveformData: state.waveformData,

    // Actions
    play,
    pause,
    togglePlay,
    seek,
    setVolume,
    toggleMute,

    // Refs
    audioRef,
  };
}
