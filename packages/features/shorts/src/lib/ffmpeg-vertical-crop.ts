/**
 * FFmpeg Vertical Crop Utility
 *
 * Converts 16:9 video to 9:16 vertical format for TikTok/Reels/Shorts
 */

export type CropMode = 'center' | 'blur_bars' | 'smart';

export interface VerticalCropOptions {
    /** Input video path */
    inputPath: string;

    /** Output video path */
    outputPath: string;

    /** Start time in seconds */
    startSeconds: number;

    /** End time in seconds */
    endSeconds: number;

    /** Crop mode:
     * - center: Simple center crop (may cut sides)
     * - blur_bars: Add blurred vertical bars (letterbox effect)
     * - smart: (future) Face detection for smart cropping
     */
    cropMode: CropMode;

    /** Output resolution (default: 1080x1920) */
    resolution?: {
        width: number;
        height: number;
    };
}

/**
 * Platform specifications for short-form video
 */
export const PLATFORM_SPECS = {
    youtube_shorts: {
        aspectRatio: '9:16',
        width: 1080,
        height: 1920,
        maxDuration: 60,
        formats: ['mp4'],
    },
    tiktok: {
        aspectRatio: '9:16',
        width: 1080,
        height: 1920,
        maxDuration: 600, // 10 min
        optimalDuration: { min: 15, max: 60 },
        formats: ['mp4'],
    },
    instagram_reels: {
        aspectRatio: '9:16',
        width: 1080,
        height: 1920,
        maxDuration: 90,
        optimalDuration: { min: 15, max: 30 },
        formats: ['mp4'],
    },
    facebook_reels: {
        aspectRatio: '9:16',
        width: 1080,
        height: 1920,
        maxDuration: 90,
        optimalDuration: { min: 15, max: 60 },
        formats: ['mp4'],
    },
} as const;

export type Platform = keyof typeof PLATFORM_SPECS;

/**
 * Build FFmpeg filter for center crop to 9:16
 *
 * Scales video to fill 9:16 frame, then crops center
 */
export function buildCenterCropFilter(
    outputWidth = 1080,
    outputHeight = 1920,
): string {
    // Scale to fill the target aspect ratio, then crop
    return `scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=increase,crop=${outputWidth}:${outputHeight}`;
}

/**
 * Build FFmpeg filter for blur bars (letterbox) effect
 *
 * Creates blurred background from video, overlays original on top
 */
export function buildBlurBarsFilter(
    outputWidth = 1080,
    outputHeight = 1920,
): string {
    // Split into background (blurred, scaled to fill) and foreground (fit)
    return [
        // Split input into two streams
        'split[a][b]',
        // Background: scale to fill, blur heavily
        `[a]scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=increase,crop=${outputWidth}:${outputHeight},boxblur=30:5[bg]`,
        // Foreground: scale to fit within bounds
        `[b]scale=${outputWidth}:${outputHeight}:force_original_aspect_ratio=decrease[fg]`,
        // Overlay foreground centered on background
        '[bg][fg]overlay=(W-w)/2:(H-h)/2',
    ].join(';');
}

/**
 * Build complete FFmpeg command for vertical crop
 */
export function buildVerticalCropCommand(options: VerticalCropOptions): string {
    const { inputPath, outputPath, startSeconds, endSeconds, cropMode } = options;
    const width = options.resolution?.width ?? 1080;
    const height = options.resolution?.height ?? 1920;

    const duration = endSeconds - startSeconds;

    // Build video filter based on crop mode
    let videoFilter: string;
    switch (cropMode) {
        case 'blur_bars':
            videoFilter = buildBlurBarsFilter(width, height);
            break;
        case 'center':
        default:
            videoFilter = buildCenterCropFilter(width, height);
            break;
    }

    // Build FFmpeg command
    const args = [
        'ffmpeg',
        '-y', // Overwrite output
        '-ss',
        startSeconds.toFixed(2), // Seek to start (before input for fast seek)
        '-i',
        `"${inputPath}"`,
        '-t',
        duration.toFixed(2), // Duration
        '-vf',
        `"${videoFilter}"`,
        '-c:v',
        'libx264', // H.264 encoding
        '-preset',
        'fast',
        '-crf',
        '23', // Good quality
        '-c:a',
        'aac', // AAC audio
        '-b:a',
        '128k',
        '-movflags',
        '+faststart', // Web optimization
        `"${outputPath}"`,
    ];

    return args.join(' ');
}

/**
 * Build FFmpeg command arguments as array (for child_process.spawn)
 */
export function buildVerticalCropArgs(
    options: VerticalCropOptions,
): string[] {
    const { inputPath, outputPath, startSeconds, endSeconds, cropMode } = options;
    const width = options.resolution?.width ?? 1080;
    const height = options.resolution?.height ?? 1920;

    const duration = endSeconds - startSeconds;

    // Build video filter based on crop mode
    let videoFilter: string;
    switch (cropMode) {
        case 'blur_bars':
            videoFilter = buildBlurBarsFilter(width, height);
            break;
        case 'center':
        default:
            videoFilter = buildCenterCropFilter(width, height);
            break;
    }

    return [
        '-y',
        '-ss',
        startSeconds.toFixed(2),
        '-i',
        inputPath,
        '-t',
        duration.toFixed(2),
        '-vf',
        videoFilter,
        '-c:v',
        'libx264',
        '-preset',
        'fast',
        '-crf',
        '23',
        '-c:a',
        'aac',
        '-b:a',
        '128k',
        '-movflags',
        '+faststart',
        outputPath,
    ];
}

/**
 * Validate clip duration for platform
 */
export function validateClipDuration(
    duration: number,
    platform: Platform,
): { valid: boolean; message?: string } {
    const spec = PLATFORM_SPECS[platform];

    if (duration > spec.maxDuration) {
        return {
            valid: false,
            message: `Duration ${duration}s exceeds ${platform} max of ${spec.maxDuration}s`,
        };
    }

    if ('optimalDuration' in spec) {
        const { min, max } = spec.optimalDuration;
        if (duration < min || duration > max) {
            return {
                valid: true,
                message: `Duration ${duration}s is outside optimal range ${min}-${max}s for ${platform}`,
            };
        }
    }

    return { valid: true };
}
