import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Img, staticFile } from 'remotion';

export type MotionEffect = 'static' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down' | 'fade-in' | 'fade-out';

export interface SceneClipProps {
  imageSrc: string;       // absolute path or URL to the image
  motion: MotionEffect;
  durationInFrames: number;
  bgColor?: string;
}

export function SceneClip({ imageSrc, motion, bgColor }: SceneClipProps) {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();

  // Progress 0→1 over the clip duration
  const progress = interpolate(frame, [0, durationInFrames - 1], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  let scale = 1;
  let translateX = 0; // percent
  let translateY = 0; // percent
  let opacity = 1;

  switch (motion) {
    case 'zoom-in':
      scale = interpolate(progress, [0, 1], [1, 1.15]);
      break;
    case 'zoom-out':
      scale = interpolate(progress, [0, 1], [1.15, 1]);
      break;
    case 'fade-in':
      opacity = interpolate(progress, [0, 0.4], [0, 1], { extrapolateRight: 'clamp' });
      scale = interpolate(progress, [0, 1], [1.02, 1.08]);
      break;
    case 'fade-out':
      opacity = interpolate(progress, [0.6, 1], [1, 0], { extrapolateLeft: 'clamp' });
      scale = interpolate(progress, [0, 1], [1.08, 1.02]);
      break;
    case 'pan-left':
      scale = 1.3;
      translateX = interpolate(progress, [0, 1], [5, -5]);
      break;
    case 'pan-right':
      scale = 1.3;
      translateX = interpolate(progress, [0, 1], [-5, 5]);
      break;
    case 'pan-up':
      scale = 1.3;
      translateY = interpolate(progress, [0, 1], [5, -5]);
      break;
    case 'pan-down':
      scale = 1.3;
      translateY = interpolate(progress, [0, 1], [-5, 5]);
      break;
    default: // static
      scale = 1;
      break;
  }

  return (
    <AbsoluteFill style={{ backgroundColor: bgColor || 'black' }}>
      <AbsoluteFill
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <img
          src={imageSrc}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transform: `scale(${scale}) translate(${translateX}%, ${translateY}%)`,
            opacity,
            willChange: 'transform, opacity',
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
