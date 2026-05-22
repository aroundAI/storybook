/**
 * FCPXML Generator
 *
 * Generates valid Final Cut Pro XML (FCPXML 1.11) project files
 * from an OpenClaw manifest. This allows OpenClaw to produce a
 * ready-to-import FCP project with all clips on the timeline.
 *
 * FCPXML uses rational time format: numerator/denominator where
 * denominator is typically the frame rate denominator (e.g., 30000/1001s for 29.97fps).
 * We use 100/1s (centiseconds) for simplicity since our clips are whole seconds.
 */
import type { OpenClawManifest, OpenClawShotEntry } from './openclaw-manifest';

// ============================================================================
// Types
// ============================================================================

interface FCPXMLOptions {
  /** Project name (defaults to episode title) */
  projectName?: string;
  /** Frame rate numerator (default: 30000 for 29.97fps) */
  frameRateNumerator?: number;
  /** Frame rate denominator (default: 1001 for 29.97fps) */
  frameRateDenominator?: number;
  /** Video width (default: 1920) */
  width?: number;
  /** Video height (default: 1080) */
  height?: number;
  /** Base path for video files (e.g., /output/episode-name/) */
  videoBasePath: string;
}

// ============================================================================
// FCPXML Generator
// ============================================================================

/**
 * Converts seconds to FCPXML rational time format.
 * Uses centisecond precision: seconds * 100 / 100s
 */
function toRationalTime(seconds: number): string {
  const centiseconds = Math.round(seconds * 100);
  return `${centiseconds}/100s`;
}

/**
 * Escapes special characters for XML attribute values.
 */
function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Generates a sanitized filename from shot data.
 */
function shotFilename(shot: OpenClawShotEntry): string {
  const desc = shot.description
    .replace(/[^a-zA-Z0-9\s]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40)
    .toLowerCase();
  return `S${shot.scene}-Shot${shot.scene}.${shot.shot}-${desc}.mp4`;
}

/**
 * Generates a valid FCPXML 1.11 project file from an OpenClaw manifest.
 *
 * The output can be imported directly into Final Cut Pro, creating:
 * - A library event named after the episode
 * - A project with all clips on the timeline in sequence order
 * - Clips grouped by scene using keyword ranges
 */
export function generateFCPXML(
  manifest: OpenClawManifest,
  options: FCPXMLOptions,
): string {
  const {
    projectName = manifest.episode.title,
    frameRateNumerator = 30000,
    frameRateDenominator = 1001,
    width = 1920,
    height = 1080,
    videoBasePath,
  } = options;

  const formatId = 'r1';
  const frameDuration = `${frameRateDenominator}/${frameRateNumerator}s`;

  // Build resource declarations
  const resources: string[] = [];
  const clips: string[] = [];

  // Format resource
  resources.push(
    `      <format id="${formatId}" name="FFVideoFormat${width}x${height}p${Math.round(frameRateNumerator / frameRateDenominator)}" frameDuration="${frameDuration}" width="${width}" height="${height}"/>`,
  );

  let timelineOffset = 0;

  for (let i = 0; i < manifest.shots.length; i++) {
    const shot = manifest.shots[i]!;
    const resourceId = `r${i + 2}`;
    const filename = shotFilename(shot);
    const videoPath =
      shot.output.videoLocalPath ??
      `${videoBasePath}/Scene-${shot.scene}/${filename}`;

    // Asset resource
    resources.push(
      `      <asset id="${resourceId}" name="${escapeXml(`S${shot.scene}-Shot${shot.scene}.${shot.shot}`)}" src="file://${escapeXml(videoPath)}" start="0/1s" duration="${toRationalTime(shot.duration)}" format="${formatId}" hasVideo="1" hasAudio="1"/>`,
    );

    // Calculate effective duration (with trimming support)
    const clipDuration = shot.duration;
    const offsetTime = toRationalTime(timelineOffset);
    const durationTime = toRationalTime(clipDuration);

    // Clip on timeline
    clips.push(
      `            <clip name="${escapeXml(`Shot ${shot.scene}.${shot.shot}`)}" offset="${offsetTime}" duration="${durationTime}" start="0/1s" format="${formatId}">
              <video ref="${resourceId}" offset="0/1s" duration="${durationTime}"/>
              <keyword start="${offsetTime}" duration="${durationTime}" value="Scene ${shot.scene}"/>
            </clip>`,
    );

    timelineOffset += clipDuration;
  }

  const totalDuration = toRationalTime(timelineOffset);

  // Assemble FCPXML
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fcpxml>
<fcpxml version="1.11">
  <resources>
${resources.join('\n')}
  </resources>
  <library>
    <event name="${escapeXml(projectName)}">
      <project name="${escapeXml(projectName)}">
        <sequence duration="${totalDuration}" format="${formatId}" tcStart="0/1s" tcFormat="NDF">
          <spine>
${clips.join('\n')}
          </spine>
        </sequence>
      </project>
    </event>
  </library>
</fcpxml>
`;
}
