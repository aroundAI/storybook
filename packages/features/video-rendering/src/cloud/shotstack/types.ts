/**
 * Shotstack API Types
 *
 * Type definitions for the Shotstack video editing API.
 * @see https://shotstack.io/docs/api/
 */

// ============================================================================
// Edit Types (Timeline Definition)
// ============================================================================

export interface ShotstackEdit {
  timeline: ShotstackTimeline;
  output: ShotstackOutput;
  merge?: ShotstackMergeField[];
  callback?: string;
  disk?: 'local' | 'mount';
}

export interface ShotstackTimeline {
  soundtrack?: ShotstackSoundtrack;
  background?: string;
  fonts?: ShotstackFont[];
  tracks: ShotstackTrack[];
  cache?: boolean;
}

export interface ShotstackTrack {
  clips: ShotstackClip[];
}

export interface ShotstackClip {
  asset: ShotstackAsset;
  start: number;
  length: number;
  fit?: 'crop' | 'cover' | 'contain' | 'none';
  scale?: number;
  position?:
    | 'top'
    | 'topRight'
    | 'right'
    | 'bottomRight'
    | 'bottom'
    | 'bottomLeft'
    | 'left'
    | 'topLeft'
    | 'center';
  offset?: ShotstackOffset;
  transition?: ShotstackTransition;
  effect?: ShotstackEffect;
  filter?: ShotstackFilter;
  opacity?: number;
  transform?: ShotstackTransform;
}

// ============================================================================
// Asset Types
// ============================================================================

export type ShotstackAsset =
  | ShotstackVideoAsset
  | ShotstackImageAsset
  | ShotstackTitleAsset
  | ShotstackHtmlAsset
  | ShotstackAudioAsset
  | ShotstackLumaAsset;

export interface ShotstackVideoAsset {
  type: 'video';
  src: string;
  trim?: number;
  volume?: number;
  volumeEffect?: 'fadeIn' | 'fadeOut' | 'fadeInFadeOut';
  crop?: ShotstackCrop;
}

export interface ShotstackImageAsset {
  type: 'image';
  src: string;
  crop?: ShotstackCrop;
}

export interface ShotstackTitleAsset {
  type: 'title';
  text: string;
  style?:
    | 'minimal'
    | 'blockbuster'
    | 'vogue'
    | 'sketchy'
    | 'skinny'
    | 'chunk'
    | 'chunkLight'
    | 'marker'
    | 'future'
    | 'subtitle';
  color?: string;
  size?:
    | 'xx-small'
    | 'x-small'
    | 'small'
    | 'medium'
    | 'large'
    | 'x-large'
    | 'xx-large';
  background?: string;
  position?:
    | 'top'
    | 'topRight'
    | 'right'
    | 'bottomRight'
    | 'bottom'
    | 'bottomLeft'
    | 'left'
    | 'topLeft'
    | 'center';
  offset?: ShotstackOffset;
}

export interface ShotstackHtmlAsset {
  type: 'html';
  html: string;
  css?: string;
  width?: number;
  height?: number;
  background?: string;
  position?:
    | 'top'
    | 'topRight'
    | 'right'
    | 'bottomRight'
    | 'bottom'
    | 'bottomLeft'
    | 'left'
    | 'topLeft'
    | 'center';
}

export interface ShotstackAudioAsset {
  type: 'audio';
  src: string;
  trim?: number;
  volume?: number;
  effect?: 'fadeIn' | 'fadeOut' | 'fadeInFadeOut';
}

export interface ShotstackLumaAsset {
  type: 'luma';
  src: string;
}

// ============================================================================
// Effect Types
// ============================================================================

export interface ShotstackTransition {
  in?: ShotstackTransitionEffect;
  out?: ShotstackTransitionEffect;
}

export type ShotstackTransitionEffect =
  | 'fade'
  | 'reveal'
  | 'wipeLeft'
  | 'wipeRight'
  | 'wipeUp'
  | 'wipeDown'
  | 'slideLeft'
  | 'slideRight'
  | 'slideUp'
  | 'slideDown'
  | 'carouselLeft'
  | 'carouselRight'
  | 'carouselUp'
  | 'carouselDown'
  | 'shuffleTopRight'
  | 'shuffleRightTop'
  | 'shuffleRightBottom'
  | 'shuffleBottomRight'
  | 'shuffleBottomLeft'
  | 'shuffleLeftBottom'
  | 'shuffleLeftTop'
  | 'shuffleTopLeft'
  | 'zoom';

export type ShotstackEffect =
  | 'zoomIn'
  | 'zoomOut'
  | 'slideLeft'
  | 'slideRight'
  | 'slideUp'
  | 'slideDown';

export type ShotstackFilter =
  | 'boost'
  | 'contrast'
  | 'darken'
  | 'greyscale'
  | 'lighten'
  | 'muted'
  | 'negative'
  | 'sepia'
  | 'vintage'
  | 'warm'
  | 'cool';

export interface ShotstackTransform {
  rotate?: ShotstackRotation;
  skew?: ShotstackSkew;
  flip?: ShotstackFlip;
}

export interface ShotstackRotation {
  angle: number;
}

export interface ShotstackSkew {
  x?: number;
  y?: number;
}

export interface ShotstackFlip {
  horizontal?: boolean;
  vertical?: boolean;
}

// ============================================================================
// Output Types
// ============================================================================

export interface ShotstackOutput {
  format: 'mp4' | 'gif' | 'jpg' | 'png' | 'bmp' | 'webm' | 'mov';
  resolution?: 'preview' | 'mobile' | 'sd' | 'hd' | '1080' | '4k';
  aspectRatio?: '16:9' | '9:16' | '1:1' | '4:5' | '4:3';
  size?: ShotstackSize;
  fps?: number;
  scaleTo?: 'preview' | 'mobile' | 'sd' | 'hd' | '1080' | '4k';
  quality?: 'low' | 'medium' | 'high';
  repeat?: boolean;
  mute?: boolean;
  range?: ShotstackRange;
  poster?: ShotstackPoster;
  thumbnail?: ShotstackThumbnail;
  destinations?: ShotstackDestination[];
}

export interface ShotstackSize {
  width?: number;
  height?: number;
}

export interface ShotstackRange {
  start?: number;
  length?: number;
}

export interface ShotstackPoster {
  capture: number;
}

export interface ShotstackThumbnail {
  capture: number;
  scale?: number;
}

export interface ShotstackDestination {
  provider: 's3' | 'shotstack' | 'mux';
  options?: Record<string, unknown>;
}

// ============================================================================
// Supplementary Types
// ============================================================================

export interface ShotstackSoundtrack {
  src: string;
  effect?: 'fadeIn' | 'fadeOut' | 'fadeInFadeOut';
  volume?: number;
}

export interface ShotstackFont {
  src: string;
}

export interface ShotstackOffset {
  x?: number;
  y?: number;
}

export interface ShotstackCrop {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

export interface ShotstackMergeField {
  find: string;
  replace: string;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ShotstackRenderResponse {
  success: boolean;
  message: string;
  response: {
    id: string;
    message: string;
  };
}

export interface ShotstackStatusResponse {
  success: boolean;
  message: string;
  response: {
    id: string;
    owner: string;
    status: 'queued' | 'fetching' | 'rendering' | 'saving' | 'done' | 'failed';
    progress?: number;
    url?: string;
    poster?: string;
    thumbnail?: string;
    error?: string;
    renderTime?: number;
    created: string;
    updated: string;
  };
}

export interface ShotstackProbeResponse {
  success: boolean;
  message: string;
  response: {
    metadata: {
      streams: ShotstackStreamMetadata[];
      format: ShotstackFormatMetadata;
    };
  };
}

export interface ShotstackStreamMetadata {
  index: number;
  codec_name: string;
  codec_type: 'video' | 'audio';
  width?: number;
  height?: number;
  duration?: number;
  fps?: number;
  sample_rate?: number;
  channels?: number;
}

export interface ShotstackFormatMetadata {
  filename: string;
  format_name: string;
  duration: number;
  size: number;
  bit_rate: number;
}
