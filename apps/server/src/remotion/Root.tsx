import React from 'react';
import { Composition, registerRoot } from 'remotion';
import { Intro } from './compositions/Intro';
import { Outro } from './compositions/Outro';
import { SceneClip } from './compositions/SceneClip';
import { ComparisonScene } from './compositions/ComparisonScene';
import { ChartBigNumber } from './compositions/ChartBigNumber';
import { ChartLine } from './compositions/ChartLine';
import { ChartBars } from './compositions/ChartBars';
import { ChartVs } from './compositions/ChartVs';
import type {
  IntroConfig, OutroConfig, SceneClipConfig, ComparisonSceneConfig,
  ChartBigNumberConfig, ChartLineConfig, ChartBarsConfig, ChartVsConfig,
} from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const IntroComp = Intro as React.ComponentType<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const OutroComp = Outro as React.ComponentType<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SceneClipComp = SceneClip as React.ComponentType<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ComparisonSceneComp = ComparisonScene as React.ComponentType<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ChartBigNumberComp = ChartBigNumber as React.ComponentType<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ChartLineComp = ChartLine as React.ComponentType<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ChartBarsComp = ChartBars as React.ComponentType<any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ChartVsComp = ChartVs as React.ComponentType<any>;

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
      {/* Chart compositions — 1920×1080 landscape (portrait variant handled via width/height props) */}
      <Composition
        id="ChartBigNumber"
        component={ChartBigNumberComp}
        durationInFrames={144}
        fps={24}
        width={1920}
        height={1080}
        defaultProps={{
          durationInFrames: 144,
          value: 99763,
          prefix: '',
          suffix: '',
          label: 'Chart label',
          sourceLabel: '',
          accentColor: '#7c6af5',
          bgColor: '#0d0e12',
        } satisfies ChartBigNumberConfig}
      />
      <Composition
        id="ChartLine"
        component={ChartLineComp}
        durationInFrames={144}
        fps={24}
        width={1920}
        height={1080}
        defaultProps={{
          durationInFrames: 144,
          dataPoints: [{ label: '2000', value: 100 }, { label: '2010', value: 500 }, { label: '2020', value: 1000 }],
          title: 'Chart Title',
          sourceLabel: '',
          accentColor: '#7c6af5',
          bgColor: '#0d0e12',
        } satisfies ChartLineConfig}
      />
      <Composition
        id="ChartBars"
        component={ChartBarsComp}
        durationInFrames={144}
        fps={24}
        width={1920}
        height={1080}
        defaultProps={{
          durationInFrames: 144,
          bars: [{ name: 'Item A', value: 80 }, { name: 'Item B', value: 60 }, { name: 'Item C', value: 40 }],
          title: 'Chart Title',
          sourceLabel: '',
          accentColor: '#7c6af5',
          bgColor: '#0d0e12',
          sortOrder: 'scripted',
        } satisfies ChartBarsConfig}
      />
      <Composition
        id="ChartVs"
        component={ChartVsComp}
        durationInFrames={144}
        fps={24}
        width={1920}
        height={1080}
        defaultProps={{
          durationInFrames: 144,
          leftLabel: 'Left',
          leftValue: '$1,000',
          rightLabel: 'Right',
          rightValue: '$2,000',
          title: '',
          accentColor: '#7c6af5',
          bgColor: '#0d0e12',
        } satisfies ChartVsConfig}
      />
    </>
  );
}

registerRoot(RemotionRoot);
