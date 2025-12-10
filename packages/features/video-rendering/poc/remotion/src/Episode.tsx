/**
 * Remotion Episode Composition
 *
 * Sample Remotion component for rendering an episode from shots.
 * This demonstrates how Remotion can be used for video composition.
 */
import React from 'react';

import {
  AbsoluteFill,
  Audio,
  Easing,
  Sequence,
  Video,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';

/**
 * Shot definition
 */
interface Shot {
  id: string;
  url: string;
  durationInFrames: number;
  transitionIn?: 'fade' | 'slide' | 'none';
  transitionDuration?: number;
}

/**
 * Audio track definition
 */
interface AudioTrack {
  id: string;
  url: string;
  startFrame: number;
  volume?: number;
}

/**
 * Episode props
 */
interface EpisodeProps {
  shots: Shot[];
  audioTracks?: AudioTrack[];
  title?: string;
  showTitle?: boolean;
}

/**
 * Episode composition - the main component that renders the full video
 */
export const Episode: React.FC<EpisodeProps> = ({
  shots,
  audioTracks = [],
  title,
  showTitle = false,
}) => {
  const { fps } = useVideoConfig();

  // Calculate total duration
  let currentFrame = 0;
  const shotPositions = shots.map((shot) => {
    const startFrame = currentFrame;
    currentFrame += shot.durationInFrames;
    return { ...shot, startFrame };
  });

  return (
    <AbsoluteFill style={{ backgroundColor: 'black' }}>
      {/* Title card */}
      {showTitle && title && (
        <Sequence from={0} durationInFrames={fps * 3}>
          <TitleCard title={title} />
        </Sequence>
      )}

      {/* Video shots */}
      {shotPositions.map((shot, index) => {
        const offset = showTitle ? fps * 3 : 0;
        return (
          <Sequence
            key={shot.id}
            from={shot.startFrame + offset}
            durationInFrames={shot.durationInFrames}
          >
            <ShotWithTransition shot={shot} isFirst={index === 0} />
          </Sequence>
        );
      })}

      {/* Audio tracks */}
      {audioTracks.map((track) => (
        <Sequence key={track.id} from={track.startFrame}>
          <Audio src={track.url} volume={track.volume ?? 1} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

/**
 * Title card component
 */
const TitleCard: React.FC<{ title: string }> = ({ title }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = interpolate(
    frame,
    [0, fps * 0.5, fps * 2.5, fps * 3],
    [0, 1, 1, 0],
    { extrapolateRight: 'clamp' },
  );

  const scale = spring({
    frame,
    fps,
    config: { damping: 200 },
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: 'black',
        justifyContent: 'center',
        alignItems: 'center',
        opacity,
      }}
    >
      <h1
        style={{
          color: 'white',
          fontSize: 72,
          fontFamily: 'Arial, sans-serif',
          transform: `scale(${scale})`,
          textAlign: 'center',
          padding: 40,
        }}
      >
        {title}
      </h1>
    </AbsoluteFill>
  );
};

/**
 * Shot with transition effects
 */
const ShotWithTransition: React.FC<{
  shot: Shot & { startFrame: number };
  isFirst: boolean;
}> = ({ shot, isFirst }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const transitionDuration = shot.transitionDuration ?? fps * 0.5;
  const transitionType = shot.transitionIn ?? 'fade';

  // Calculate opacity for fade transition
  let opacity = 1;
  let translateX = 0;

  if (!isFirst && transitionType !== 'none') {
    if (transitionType === 'fade') {
      opacity = interpolate(frame, [0, transitionDuration], [0, 1], {
        extrapolateRight: 'clamp',
      });
    } else if (transitionType === 'slide') {
      translateX = interpolate(frame, [0, transitionDuration], [100, 0], {
        extrapolateRight: 'clamp',
        easing: Easing.out(Easing.cubic),
      });
    }
  }

  return (
    <AbsoluteFill
      style={{
        opacity,
        transform: `translateX(${translateX}%)`,
      }}
    >
      <Video
        src={shot.url}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * Crossfade transition component
 * Use this when you need to crossfade between two specific shots
 */
export const CrossfadeTransition: React.FC<{
  fromUrl: string;
  toUrl: string;
  durationInFrames: number;
}> = ({ fromUrl, toUrl, durationInFrames }) => {
  const frame = useCurrentFrame();

  const opacity = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateRight: 'clamp',
  });

  return (
    <AbsoluteFill>
      {/* Background (from) */}
      <AbsoluteFill>
        <Video
          src={fromUrl}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </AbsoluteFill>

      {/* Foreground (to) with increasing opacity */}
      <AbsoluteFill style={{ opacity }}>
        <Video
          src={toUrl}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

/**
 * Default export for Remotion
 */
export default Episode;
