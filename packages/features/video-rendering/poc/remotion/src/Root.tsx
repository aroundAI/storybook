/**
 * Remotion Root Component
 *
 * Entry point for Remotion compositions.
 */

import React from 'react';
import { Composition } from 'remotion';
import { Episode } from './Episode';

/**
 * Sample shots for testing
 */
const SAMPLE_SHOTS = [
  {
    id: 'shot-1',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    durationInFrames: 150, // 5 seconds at 30fps
    transitionIn: 'fade' as const,
  },
  {
    id: 'shot-2',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
    durationInFrames: 150,
    transitionIn: 'slide' as const,
  },
  {
    id: 'shot-3',
    url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/Sintel.mp4',
    durationInFrames: 150,
    transitionIn: 'fade' as const,
  },
];

/**
 * Root component - registers all compositions
 */
export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Main Episode composition */}
      <Composition
        id="Episode"
        component={Episode}
        durationInFrames={600} // 20 seconds
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          shots: SAMPLE_SHOTS,
          title: 'Sample Episode',
          showTitle: true,
        }}
      />

      {/* Short-form version for TikTok/Reels */}
      <Composition
        id="EpisodeVertical"
        component={Episode}
        durationInFrames={450} // 15 seconds
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{
          shots: SAMPLE_SHOTS.slice(0, 2),
          showTitle: false,
        }}
      />

      {/* Preview composition (lower quality, faster render) */}
      <Composition
        id="EpisodePreview"
        component={Episode}
        durationInFrames={600}
        fps={30}
        width={854}
        height={480}
        defaultProps={{
          shots: SAMPLE_SHOTS,
          showTitle: false,
        }}
      />
    </>
  );
};

export default RemotionRoot;
