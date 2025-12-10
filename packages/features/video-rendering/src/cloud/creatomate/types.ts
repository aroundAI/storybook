/**
 * Creatomate API Types
 *
 * Type definitions for the Creatomate video rendering API.
 * @see https://creatomate.com/docs/api/
 */

// ============================================================================
// Render Request Types
// ============================================================================

export interface CreatomateRenderRequest {
  /** Template ID or source definition */
  source: CreatomateSource | string;

  /** Output format configuration */
  output_format?: 'mp4' | 'gif' | 'png' | 'jpg';

  /** Frame rate */
  frame_rate?: number;

  /** Output width */
  width?: number;

  /** Output height */
  height?: number;

  /** Render quality */
  render_scale?: number;

  /** Variable modifications */
  modifications?: Record<string, unknown>;

  /** Webhook URL for completion notification */
  webhook_url?: string;

  /** Custom metadata */
  metadata?: string;

  /** Max render duration (for template-based renders) */
  max_duration?: number;
}

// ============================================================================
// Source Types
// ============================================================================

export interface CreatomateSource {
  /** Output format */
  output_format: 'mp4' | 'gif' | 'png' | 'jpg';

  /** Frame rate */
  frame_rate?: number;

  /** Width in pixels */
  width: number;

  /** Height in pixels */
  height: number;

  /** Duration in seconds */
  duration?: number;

  /** Background fill */
  fill_color?: string;

  /** Elements on the composition */
  elements: CreatomateElement[];
}

// ============================================================================
// Element Types
// ============================================================================

export type CreatomateElement =
  | CreatomateVideoElement
  | CreatomateImageElement
  | CreatomateAudioElement
  | CreatomateTextElement
  | CreatomateCompositionElement;

export interface CreatomateBaseElement {
  /** Element name/ID */
  name?: string;

  /** Track index (for z-ordering) */
  track?: number;

  /** Time range */
  time?: number | string;
  duration?: number | string;

  /** Position and size */
  x?: number | string;
  y?: number | string;
  width?: number | string;
  height?: number | string;

  /** Transform */
  x_anchor?: number | string;
  y_anchor?: number | string;
  x_scale?: number | string;
  y_scale?: number | string;
  rotation?: number | string;

  /** Opacity */
  opacity?: number | string;

  /** Animations */
  enter?: CreatomateAnimation;
  exit?: CreatomateAnimation;
}

export interface CreatomateVideoElement extends CreatomateBaseElement {
  type: 'video';

  /** Video source URL */
  source: string;

  /** Trim start */
  trim_start?: number;

  /** Trim end (duration from start) */
  trim_duration?: number;

  /** Volume (0-1) */
  volume?: number | string;

  /** Audio fade */
  audio_fade_in?: number;
  audio_fade_out?: number;

  /** Video fit mode */
  fit?: 'cover' | 'contain' | 'fill' | 'none';

  /** Loop video */
  loop?: boolean;

  /** Mute video */
  muted?: boolean;
}

export interface CreatomateImageElement extends CreatomateBaseElement {
  type: 'image';

  /** Image source URL */
  source: string;

  /** Image fit mode */
  fit?: 'cover' | 'contain' | 'fill' | 'none';
}

export interface CreatomateAudioElement extends CreatomateBaseElement {
  type: 'audio';

  /** Audio source URL */
  source: string;

  /** Trim start */
  trim_start?: number;

  /** Trim duration */
  trim_duration?: number;

  /** Volume (0-1) */
  volume?: number | string;

  /** Audio fade */
  audio_fade_in?: number;
  audio_fade_out?: number;

  /** Loop audio */
  loop?: boolean;
}

export interface CreatomateTextElement extends CreatomateBaseElement {
  type: 'text';

  /** Text content */
  text: string;

  /** Font family */
  font_family?: string;

  /** Font weight */
  font_weight?: number | string;

  /** Font size */
  font_size?: number | string;

  /** Font color */
  fill_color?: string;

  /** Text alignment */
  x_alignment?: 'left' | 'center' | 'right';
  y_alignment?: 'top' | 'center' | 'bottom';

  /** Line height */
  line_height?: number | string;

  /** Letter spacing */
  letter_spacing?: number | string;

  /** Background */
  background_color?: string;
  background_x_padding?: number | string;
  background_y_padding?: number | string;
  background_border_radius?: number | string;
}

export interface CreatomateCompositionElement extends CreatomateBaseElement {
  type: 'composition';

  /** Nested elements */
  elements: CreatomateElement[];

  /** Fill color */
  fill_color?: string;
}

// ============================================================================
// Animation Types
// ============================================================================

export interface CreatomateAnimation {
  /** Animation type */
  type:
    | 'fade'
    | 'scale'
    | 'slide'
    | 'wipe'
    | 'rotate'
    | 'blur'
    | 'typewriter'
    | 'text-slide'
    | 'text-appear'
    | 'text-fly'
    | 'text-reveal';

  /** Animation duration */
  duration?: number;

  /** Animation easing */
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';

  /** Animation direction (for slide/wipe) */
  direction?: 'left' | 'right' | 'up' | 'down';

  /** Start value (for scale) */
  start_scale?: number;

  /** End value (for scale) */
  end_scale?: number;

  /** Fade to/from */
  fade?: number;

  /** Blur amount */
  blur?: number;

  /** X offset (for slide) */
  x_offset?: number | string;

  /** Y offset (for slide) */
  y_offset?: number | string;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface CreatomateRenderResponse {
  /** Render ID */
  id: string;

  /** Render status */
  status:
    | 'planned'
    | 'waiting'
    | 'transcribing'
    | 'rendering'
    | 'succeeded'
    | 'failed';

  /** Error message (if failed) */
  error_message?: string;

  /** Output URL (when succeeded) */
  url?: string;

  /** Snapshot URLs (for preview frames) */
  snapshot_url?: string;

  /** Render progress (0-1) */
  progress?: number;

  /** Template ID (if template-based) */
  template_id?: string;

  /** Template name */
  template_name?: string;

  /** Output format */
  output_format?: string;

  /** Render width */
  width?: number;

  /** Render height */
  height?: number;

  /** Frame rate */
  frame_rate?: number;

  /** Duration in seconds */
  duration?: number;

  /** File size in bytes */
  file_size?: number;

  /** Custom metadata */
  metadata?: string;

  /** Created timestamp */
  created_at?: string;

  /** Completed timestamp */
  completed_at?: string;
}

export interface CreatomateTemplateResponse {
  /** Template ID */
  id: string;

  /** Template name */
  name: string;

  /** Template tags */
  tags?: string[];

  /** Template preview URL */
  preview_url?: string;

  /** Source definition */
  source?: CreatomateSource;

  /** Created timestamp */
  created_at?: string;

  /** Updated timestamp */
  updated_at?: string;
}

export interface CreatomateErrorResponse {
  /** Error message */
  message: string;

  /** Error code */
  code?: string;
}
