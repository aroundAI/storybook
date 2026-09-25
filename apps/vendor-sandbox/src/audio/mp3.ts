/**
 * A valid MP3 of a given length, with no encoder: silent MPEG-1 Layer III
 * frames. Each frame holds 1152 samples at 44.1 kHz (26.12 ms); a frame whose
 * side information is all zero decodes as silence in every decoder, so a
 * waveform, a duration read and a timeline all get a real file.
 *
 * Header: sync, MPEG-1, Layer III, no CRC, 128 kbit/s, 44.1 kHz, mono.
 */
const SAMPLE_RATE = 44_100;
const SAMPLES_PER_FRAME = 1152;
const BITRATE = 128_000;
const FRAME_BYTES = Math.floor((144 * BITRATE) / SAMPLE_RATE); // 417
const HEADER = [0xff, 0xfb, 0x90, 0xc4];

export const FRAME_SECONDS = SAMPLES_PER_FRAME / SAMPLE_RATE;

/** Frames for `seconds` of audio, at least one. */
export function framesFor(seconds: number) {
  return Math.max(1, Math.round(seconds / FRAME_SECONDS));
}

export function silentMp3(seconds: number) {
  const frames = framesFor(seconds);
  const out = Buffer.alloc(frames * FRAME_BYTES);
  for (let i = 0; i < frames; i++) {
    out.set(HEADER, i * FRAME_BYTES);
  }
  return out;
}

/** Duration by walking frame headers: what a player would measure. */
export function mp3Duration(buffer: Uint8Array) {
  let frames = 0;
  let at = 0;
  while (at + 4 <= buffer.length) {
    if (buffer[at] !== 0xff || (buffer[at + 1]! & 0xe0) !== 0xe0) return NaN;
    const padding = (buffer[at + 2]! >> 1) & 1;
    frames += 1;
    at += FRAME_BYTES + padding;
  }
  return frames * FRAME_SECONDS;
}

/** Spoken length of a line: about 150 words a minute, never under 0.6 s. */
export function speechSeconds(text: string) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(0.6, (words / 150) * 60);
}
