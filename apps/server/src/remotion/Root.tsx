import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { Intro } from './compositions/Intro';
import { Outro } from './compositions/Outro';
import { SceneClip } from './compositions/SceneClip';
import { ComparisonScene } from './compositions/ComparisonScene';
import type { IntroConfig, OutroConfig, SceneClipConfig, ComparisonSceneConfig } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const IntroComp = Intro as React.ComponentType<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const OutroComp = Outro as React.ComponentType<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SceneClipComp = SceneClip as React.ComponentType<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ComparisonSceneComp = ComparisonScene as React.ComponentType<any>;

function RemotionRoot() {
  return (
    <>
      <Composition
        id="Intro"
        component={IntroComp}
        durationInFrames={72}
        fps={24}
        width={1080}
        height={1920}
        defaultProps={{
          creatorName: 'Creator',
          accentColor: '#7c6af5',
          style: 'minimal',
          durationInFrames: 72,
        } satisfies IntroConfig}
      />
      <Composition
        id="Outro"
        component={OutroComp}
        durationInFrames={72}
        fps={24}
        width={1080}
        height={1920}
        defaultProps={{
          creatorName: 'Creator',
          ctaText: 'Follow for more!',
          accentColor: '#7c6af5',
          durationInFrames: 72,
        } satisfies OutroConfig}
      />
      <Composition
        id="SceneClip"
        component={SceneClipComp}
        durationInFrames={120}
        fps={24}
        width={1920}
        height={1080}
        defaultProps={{
          imageSrc: '',
          motion: 'static',
          durationInFrames: 120,
          bgColor: 'black',
        } satisfies SceneClipConfig}
      />
      <Composition
        id="ComparisonScene"
        component={ComparisonSceneComp}
        durationInFrames={120}
        fps={24}
        width={1080}
        height={1920}
        defaultProps={{
          durationInFrames: 120,
          leftMediaSrc: '',
          leftMediaType: 'image',
          leftName: 'Left',
          leftScore: 0,
          rightMediaSrc: '',
          rightMediaType: 'image',
          rightName: 'Right',
          rightScore: 0,
          mascotSrc: '',
          layout: {
            left: { x: 0, y: 0, w: 50, h: 58 },
            mascot: { x: 20, y: 58, w: 60, h: 42 },
            right: { x: 50, y: 0, w: 50, h: 58 },
          },
          activeSide: 'both',
          roundPanels: true,
          bgType: 'color',
          bgSrc: '#0d0e12',
        } satisfies ComparisonSceneConfig}
      />
    </>
  );
}

registerRoot(RemotionRoot);
