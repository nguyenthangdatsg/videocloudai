import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { Intro } from './compositions/Intro';
import { Outro } from './compositions/Outro';
import { SceneClip } from './compositions/SceneClip';
import type { IntroConfig, OutroConfig, SceneClipConfig } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const IntroComp = Intro as React.ComponentType<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const OutroComp = Outro as React.ComponentType<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SceneClipComp = SceneClip as React.ComponentType<any>;

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
        } satisfies SceneClipConfig}
      />
    </>
  );
}

registerRoot(RemotionRoot);
