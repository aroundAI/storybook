import '@testing-library/jest-dom';
import { vi } from 'vitest';

// UI components are mocked via vitest.config.ts aliases pointing to src/__mocks__/@kit/ui/*

// Mock HTMLAudioElement
class MockAudioElement {
  src = '';
  currentTime = 0;
  duration = 120;
  volume = 1;
  muted = false;
  paused = true;
  preload = '';
  error: MediaError | null = null;

  private eventListeners: Map<string, Set<EventListener>> = new Map();

  play = vi.fn().mockResolvedValue(undefined);
  pause = vi.fn();
  load = vi.fn();

  addEventListener(event: string, handler: EventListener) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)?.add(handler);
  }

  removeEventListener(event: string, handler: EventListener) {
    this.eventListeners.get(event)?.delete(handler);
  }

  dispatchEvent(event: Event) {
    this.eventListeners.get(event.type)?.forEach((handler) => handler(event));
    return true;
  }

  // Helper method for tests to trigger events
  triggerEvent(eventType: string) {
    const event = new Event(eventType);
    this.dispatchEvent(event);
  }
}

// Mock Audio constructor
globalThis.Audio = vi.fn(
  () => new MockAudioElement(),
) as unknown as typeof Audio;

// Mock AudioContext
class MockAudioBuffer {
  duration = 120;
  sampleRate = 44100;
  numberOfChannels = 2;

  getChannelData() {
    // Return a simple waveform pattern
    const data = new Float32Array(44100 * 2); // 2 seconds of audio
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.sin(i * 0.01) * 0.5;
    }
    return data;
  }
}

class MockAudioContext {
  decodeAudioData = vi.fn().mockResolvedValue(new MockAudioBuffer());
  close = vi.fn().mockResolvedValue(undefined);
}

globalThis.AudioContext = MockAudioContext as unknown as typeof AudioContext;

// Mock fetch for audio files
globalThis.fetch = vi.fn((url: string | URL) => {
  const urlString = typeof url === 'string' ? url : url.toString();

  if (urlString.includes('error')) {
    return Promise.resolve({
      ok: false,
      status: 404,
    } as Response);
  }

  return Promise.resolve({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(1000)),
  } as Response);
}) as unknown as typeof fetch;

// Mock ResizeObserver
globalThis.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock window.devicePixelRatio
Object.defineProperty(globalThis, 'devicePixelRatio', {
  value: 1,
  writable: true,
});

// Mock getComputedStyle
globalThis.getComputedStyle = vi.fn().mockReturnValue({
  getPropertyValue: (prop: string) => {
    if (prop === '--primary') return '221.2 83.2% 53.3%';
    if (prop === '--muted') return '210 40% 96.1%';
    return '';
  },
});

// Mock canvas context
HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue({
  clearRect: vi.fn(),
  fillRect: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  quadraticCurveTo: vi.fn(),
  closePath: vi.fn(),
  fill: vi.fn(),
  scale: vi.fn(),
  fillStyle: '',
});
