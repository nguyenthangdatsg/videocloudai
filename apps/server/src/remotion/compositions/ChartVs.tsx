import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import type { ChartVsConfig } from '../types';

export function ChartVs(props: ChartVsConfig) {
  const {
    leftLabel,
    leftValue,
    rightLabel,
    rightValue,
    title,
    accentColor = '#7c6af5',
    bgColor = '#0d0e12',
    durationInFrames,
    animationFrames,
  } = props;

  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const holdAt = animationFrames ?? Math.floor(durationInFrames * 0.95);

  const progress = interpolate(frame, [0, holdAt], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateRight: 'clamp',
  });

  const fadeIn = interpolate(frame, [0, Math.min(fps * 0.3, 7)], [0, 1], { extrapolateRight: 'clamp' });
  const vsScale = interpolate(frame, [0, Math.min(fps * 0.5, 12)], [0.5, 1], {
    easing: Easing.out(Easing.back(1.5)),
    extrapolateRight: 'clamp',
  });

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: bgColor,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
      opacity: fadeIn,
    }}>
      {title && (
        <p style={{
          color: 'rgba(255,255,255,0.6)',
          fontSize: 38,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: 48,
          textAlign: 'center',
        }}>
          {title}
        </p>
      )}

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 0,
        width: '100%',
        justifyContent: 'center',
      }}>
        {/* Left */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          opacity: progress,
          transform: `translateX(${(1 - progress) * -40}px)`,
        }}>
          <div style={{
            color: '#ffffff',
            fontSize: 96,
            fontWeight: 900,
            letterSpacing: '-0.03em',
            lineHeight: 1,
            textAlign: 'center',
          }}>
            {leftValue}
          </div>
          <div style={{
            color: 'rgba(255,255,255,0.5)',
            fontSize: 34,
            marginTop: 16,
            textAlign: 'center',
            padding: '0 40px',
          }}>
            {leftLabel}
          </div>
        </div>

        {/* VS */}
        <div style={{
          color: accentColor,
          fontSize: 72,
          fontWeight: 900,
          letterSpacing: '-0.02em',
          padding: '0 32px',
          transform: `scale(${vsScale})`,
          textShadow: `0 0 40px ${accentColor}66`,
        }}>
          VS
        </div>

        {/* Right */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          opacity: progress,
          transform: `translateX(${(1 - progress) * 40}px)`,
        }}>
          <div style={{
            color: '#ffffff',
            fontSize: 96,
            fontWeight: 900,
            letterSpacing: '-0.03em',
            lineHeight: 1,
            textAlign: 'center',
          }}>
            {rightValue}
          </div>
          <div style={{
            color: 'rgba(255,255,255,0.5)',
            fontSize: 34,
            marginTop: 16,
            textAlign: 'center',
            padding: '0 40px',
          }}>
            {rightLabel}
          </div>
        </div>
      </div>
    </div>
  );
}
