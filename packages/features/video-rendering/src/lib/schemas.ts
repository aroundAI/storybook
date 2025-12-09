/**
 * Video Rendering Zod Schemas
 *
 * Validation schemas for all rendering types.
 */

import { z } from 'zod';

/**
 * Render provider enum
 */
export const RenderProviderSchema = z.enum([
  'ffmpeg-local',
  'ffmpeg-docker',
  'remotion',
  'shotstack',
  'creatomate',
  'mux',
]);

/**
 * Render status enum
 */
export const RenderStatusSchema = z.enum([
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
]);

/**
 * Transition type enum
 */
export const TransitionTypeSchema = z.enum([
  'cut',
  'fade',
  'crossfade',
  'dissolve',
  'wipe-left',
  'wipe-right',
  'wipe-up',
  'wipe-down',
]);

/**
 * Output format enum
 */
export const OutputFormatSchema = z.enum(['mp4', 'webm', 'mov']);

/**
 * Resolution enum
 */
export const ResolutionSchema = z.enum(['480p', '720p', '1080p', '4k']);

/**
 * Quality preset enum
 */
export const QualityPresetSchema = z.enum(['draft', 'standard', 'high']);

/**
 * Video codec enum
 */
export const VideoCodecSchema = z.enum(['h264', 'h265', 'vp9', 'av1']);

/**
 * Audio codec enum
 */
export const AudioCodecSchema = z.enum(['aac', 'mp3', 'opus', 'vorbis']);

/**
 * Video clip schema
 */
export const VideoClipSchema = z.object({
  id: z.string().min(1),
  sourceUrl: z.string().url().or(z.string().min(1)), // URL or file path
  duration: z.number().positive(),
  startTime: z.number().min(0),
  endTime: z.number().positive().optional(),
  inPoint: z.number().min(0).optional(),
  outPoint: z.number().positive().optional(),
  volume: z.number().min(0).max(2).default(1).optional(),
});

/**
 * Audio clip schema
 */
export const AudioClipSchema = z.object({
  id: z.string().min(1),
  sourceUrl: z.string().url().or(z.string().min(1)),
  startTime: z.number().min(0),
  duration: z.number().positive(),
  volume: z.number().min(0).max(2).default(1).optional(),
  fadeIn: z.number().min(0).optional(),
  fadeOut: z.number().min(0).optional(),
  isBackground: z.boolean().default(false).optional(),
});

/**
 * Transition schema
 */
export const TransitionSchema = z.object({
  type: TransitionTypeSchema,
  duration: z.number().positive().max(5), // Max 5 second transitions
  easing: z
    .enum(['linear', 'ease-in', 'ease-out', 'ease-in-out'])
    .default('linear')
    .optional(),
});

/**
 * Text overlay schema
 */
export const TextOverlaySchema = z.object({
  text: z.string().min(1).max(500),
  startTime: z.number().min(0),
  duration: z.number().positive(),
  x: z.number().min(0).max(1).default(0.5).optional(),
  y: z.number().min(0).max(1).default(0.5).optional(),
  fontSize: z.number().positive().default(24).optional(),
  fontColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .default('#FFFFFF')
    .optional(),
  backgroundColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{6}$/)
    .optional(),
  fontFamily: z.string().default('Arial').optional(),
});

/**
 * Render request schema
 */
export const RenderRequestSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().optional(),
  accountId: z.string().optional(),
  shots: z.array(VideoClipSchema).min(1).max(100), // 1-100 clips
  audioTracks: z.array(AudioClipSchema).max(10).optional(),
  transitions: z.array(TransitionSchema).optional(),
  textOverlays: z.array(TextOverlaySchema).max(50).optional(),
  outputFormat: OutputFormatSchema,
  resolution: ResolutionSchema,
  quality: QualityPresetSchema,
  videoCodec: VideoCodecSchema.optional(),
  audioCodec: AudioCodecSchema.optional(),
  framerate: z.number().min(1).max(60).default(30).optional(),
  callbackUrl: z.string().url().optional(),
});

/**
 * Render result schema
 */
export const RenderResultSchema = z.object({
  jobId: z.string().min(1),
  status: RenderStatusSchema,
  progress: z.number().min(0).max(100).optional(),
  outputUrl: z.string().url().optional(),
  duration: z.number().positive().optional(),
  fileSize: z.number().positive().optional(),
  renderTime: z.number().positive().optional(),
  error: z.string().optional(),
  estimatedTimeRemaining: z.number().min(0).optional(),
});

/**
 * Provider config schema
 */
export const ProviderConfigSchema = z.object({
  ffmpegPath: z.string().optional(),
  ffprobePath: z.string().optional(),
  tempDir: z.string().optional(),
  maxConcurrency: z.number().positive().max(16).default(4).optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().url().optional(),
  timeout: z.number().positive().default(600000).optional(), // 10 min default
});

/**
 * Type exports inferred from schemas
 */
export type RenderProviderType = z.infer<typeof RenderProviderSchema>;
export type RenderStatusType = z.infer<typeof RenderStatusSchema>;
export type TransitionTypeType = z.infer<typeof TransitionTypeSchema>;
export type OutputFormatType = z.infer<typeof OutputFormatSchema>;
export type ResolutionType = z.infer<typeof ResolutionSchema>;
export type QualityPresetType = z.infer<typeof QualityPresetSchema>;
export type VideoClipInput = z.infer<typeof VideoClipSchema>;
export type AudioClipInput = z.infer<typeof AudioClipSchema>;
export type TransitionInput = z.infer<typeof TransitionSchema>;
export type TextOverlayInput = z.infer<typeof TextOverlaySchema>;
export type RenderRequestInput = z.infer<typeof RenderRequestSchema>;
export type RenderResultOutput = z.infer<typeof RenderResultSchema>;
export type ProviderConfigInput = z.infer<typeof ProviderConfigSchema>;
