/**
 * FFmpeg Filter Graphs
 *
 * Complex filter graph generation for advanced video effects.
 */

import type { TextOverlay, VideoClip, Transition } from '../types';

/**
 * Filter graph node representation
 */
interface FilterNode {
  filter: string;
  inputs: string[];
  outputs: string[];
}

/**
 * Build a complex filter graph from nodes
 */
export function buildFilterGraph(nodes: FilterNode[]): string {
  return nodes
    .map((node) => {
      const inputLabels = node.inputs.map((i) => `[${i}]`).join('');
      const outputLabels = node.outputs.map((o) => `[${o}]`).join('');
      return `${inputLabels}${node.filter}${outputLabels}`;
    })
    .join(';');
}

/**
 * Generate filter for text overlay
 */
export function generateTextOverlayFilter(
  overlay: TextOverlay,
  inputLabel: string,
  outputLabel: string
): FilterNode {
  const {
    text,
    startTime,
    duration,
    x = 0.5,
    y = 0.5,
    fontSize = 24,
    fontColor = 'white',
    backgroundColor,
    fontFamily = 'Arial',
  } = overlay;

  // Convert normalized coordinates to FFmpeg expressions
  const xExpr = `(w-tw)*${x}`;
  const yExpr = `(h-th)*${y}`;

  // Escape special characters in text
  const escapedText = text
    .replace(/'/g, "'\\''")
    .replace(/:/g, '\\:')
    .replace(/\\/g, '\\\\');

  let filter = `drawtext=text='${escapedText}'`;
  filter += `:fontsize=${fontSize}`;
  filter += `:fontcolor=${fontColor.replace('#', '0x')}`;
  filter += `:fontfile=/usr/share/fonts/truetype/${fontFamily.toLowerCase()}.ttf`;
  filter += `:x=${xExpr}:y=${yExpr}`;
  filter += `:enable='between(t,${startTime},${startTime + duration})'`;

  if (backgroundColor) {
    filter += `:box=1:boxcolor=${backgroundColor.replace('#', '0x')}@0.5:boxborderw=5`;
  }

  return {
    filter,
    inputs: [inputLabel],
    outputs: [outputLabel],
  };
}

/**
 * Generate fade in/out filter for a clip
 */
export function generateFadeFilter(
  duration: number,
  fadeIn: number = 0,
  fadeOut: number = 0,
  inputLabel: string,
  outputLabel: string
): FilterNode {
  const filters: string[] = [];

  if (fadeIn > 0) {
    filters.push(`fade=t=in:st=0:d=${fadeIn}`);
  }

  if (fadeOut > 0) {
    const fadeOutStart = duration - fadeOut;
    filters.push(`fade=t=out:st=${fadeOutStart}:d=${fadeOut}`);
  }

  return {
    filter: filters.join(',') || 'copy',
    inputs: [inputLabel],
    outputs: [outputLabel],
  };
}

/**
 * Generate trim filter for extracting a portion of video
 */
export function generateTrimFilter(
  clip: VideoClip,
  inputIndex: number,
  outputLabel: string
): FilterNode {
  const filters: string[] = [];

  // Trim video
  if (clip.inPoint !== undefined || clip.outPoint !== undefined) {
    const start = clip.inPoint ?? 0;
    const end = clip.outPoint ?? clip.duration;
    filters.push(`trim=start=${start}:end=${end}`);
    filters.push('setpts=PTS-STARTPTS');
  }

  // Scale if needed (handled separately in most cases)
  return {
    filter: filters.length > 0 ? filters.join(',') : 'copy',
    inputs: [`${inputIndex}:v`],
    outputs: [outputLabel],
  };
}

/**
 * Generate audio trim filter
 */
export function generateAudioTrimFilter(
  clip: VideoClip,
  inputIndex: number,
  outputLabel: string
): FilterNode {
  const filters: string[] = [];

  if (clip.inPoint !== undefined || clip.outPoint !== undefined) {
    const start = clip.inPoint ?? 0;
    const end = clip.outPoint ?? clip.duration;
    filters.push(`atrim=start=${start}:end=${end}`);
    filters.push('asetpts=PTS-STARTPTS');
  }

  if (clip.volume !== undefined && clip.volume !== 1) {
    filters.push(`volume=${clip.volume}`);
  }

  return {
    filter: filters.length > 0 ? filters.join(',') : 'acopy',
    inputs: [`${inputIndex}:a`],
    outputs: [outputLabel],
  };
}

/**
 * Generate color correction filter
 */
export function generateColorCorrectionFilter(
  brightness: number = 0,
  contrast: number = 1,
  saturation: number = 1,
  inputLabel: string,
  outputLabel: string
): FilterNode {
  // eq filter: brightness (-1 to 1), contrast (0 to 2), saturation (0 to 3)
  return {
    filter: `eq=brightness=${brightness}:contrast=${contrast}:saturation=${saturation}`,
    inputs: [inputLabel],
    outputs: [outputLabel],
  };
}

/**
 * Generate blur filter
 */
export function generateBlurFilter(
  radius: number,
  inputLabel: string,
  outputLabel: string
): FilterNode {
  return {
    filter: `boxblur=${radius}:${radius}`,
    inputs: [inputLabel],
    outputs: [outputLabel],
  };
}

/**
 * Generate picture-in-picture overlay filter
 */
export function generatePipFilter(
  mainLabel: string,
  overlayLabel: string,
  position: { x: number; y: number },
  scale: number,
  outputLabel: string
): FilterNode {
  // Scale the overlay first, then overlay on main
  const xPos = Math.round(position.x * 100);
  const yPos = Math.round(position.y * 100);

  return {
    filter: `overlay=x=W*${position.x}-w*${position.x}:y=H*${position.y}-h*${position.y}`,
    inputs: [mainLabel, overlayLabel],
    outputs: [outputLabel],
  };
}

/**
 * Generate speed change filter
 */
export function generateSpeedFilter(
  speed: number, // 0.5 = half speed, 2 = double speed
  inputLabel: string,
  outputLabel: string
): FilterNode {
  // setpts for video, atempo for audio (handled separately)
  const pts = 1 / speed;
  return {
    filter: `setpts=${pts}*PTS`,
    inputs: [inputLabel],
    outputs: [outputLabel],
  };
}

/**
 * Generate audio speed filter
 */
export function generateAudioSpeedFilter(
  speed: number,
  inputLabel: string,
  outputLabel: string
): FilterNode {
  // atempo only supports 0.5 to 2.0, chain for larger changes
  if (speed < 0.5 || speed > 2.0) {
    // Chain multiple atempo filters
    const filters: string[] = [];
    let remaining = speed;
    while (remaining < 0.5) {
      filters.push('atempo=0.5');
      remaining /= 0.5;
    }
    while (remaining > 2.0) {
      filters.push('atempo=2.0');
      remaining /= 2.0;
    }
    filters.push(`atempo=${remaining}`);
    return {
      filter: filters.join(','),
      inputs: [inputLabel],
      outputs: [outputLabel],
    };
  }

  return {
    filter: `atempo=${speed}`,
    inputs: [inputLabel],
    outputs: [outputLabel],
  };
}

/**
 * Generate reverse filter
 */
export function generateReverseFilter(
  inputLabel: string,
  outputLabel: string
): FilterNode {
  return {
    filter: 'reverse',
    inputs: [inputLabel],
    outputs: [outputLabel],
  };
}

/**
 * Build a complete filter graph for an episode with all effects
 */
export function buildEpisodeFilterGraph(
  clips: VideoClip[],
  transitions: Transition[],
  textOverlays: TextOverlay[]
): string {
  const nodes: FilterNode[] = [];
  let currentVideoLabel = '0:v';

  // Process each clip with transitions
  for (let i = 1; i < clips.length; i++) {
    const transition = transitions[i - 1];
    if (transition && transition.type !== 'cut') {
      const offset = clips[i - 1].duration - transition.duration;
      const outputLabel = i === clips.length - 1 ? 'transitioned' : `v${i}`;

      nodes.push({
        filter: `xfade=transition=fade:duration=${transition.duration}:offset=${offset}`,
        inputs: [currentVideoLabel, `${i}:v`],
        outputs: [outputLabel],
      });

      currentVideoLabel = outputLabel;
    }
  }

  // Add text overlays
  let overlayInputLabel = currentVideoLabel;
  textOverlays.forEach((overlay, i) => {
    const outputLabel = i === textOverlays.length - 1 ? 'outv' : `text${i}`;
    nodes.push(generateTextOverlayFilter(overlay, overlayInputLabel, outputLabel));
    overlayInputLabel = outputLabel;
  });

  // If no overlays, rename final label
  if (textOverlays.length === 0 && currentVideoLabel !== 'outv') {
    nodes.push({
      filter: 'copy',
      inputs: [currentVideoLabel],
      outputs: ['outv'],
    });
  }

  return buildFilterGraph(nodes);
}
