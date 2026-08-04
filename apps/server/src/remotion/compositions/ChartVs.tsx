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
  const { fps, width: W, height: H } = useVideoConfig();
  const holdAt = animationFrames ?? Math.floor(durationInFrames * 0.95);
  const isPortrait = H > W;
  const scale = Math.min(W, H) / 1080;

  const progress = interpolate(frame, [0, holdAt], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateRight: 'clamp',
  });

  const fadeIn = interpolate(frame, [0, Math.min(fps * 0.3, 7)], [0, 1], { extrapolateRight: 'clamp' });
  const vsScaleAnim = interpolate(frame, [0, Math.min(fps * 0.5, 12)], [0.5, 1], {
    easing: Easing.out(Easing.back(1.5)),
    extrapolateRight: 'clamp',
  });

  const safeMargin = Math.round(Math.min(W, H) * 0.08);
  const valueFontSize = Math.round((isPortrait ? 80 : 96) * scale);
  const labelFontSize = Math.round((isPortrait ? 30 : 34) * scale);
  const titleFontSize = Math.round((isPortrait ? 34 : 38) * scale);
  const vsFontSize = Math.round((isPortrait ? 56 : 72) * scale);

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
          fontSize: titleFontSize,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          marginBottom: Math.round((isPortrait ? 60 : 48) * scale),
          textAlign: 'center',
          padding: `0 ${safeMargin}px`,
        }}>
          {title}
        </p>
      )}

      <div style={{
        display: 'flex',
        flexDirection: isPortrait ? 'column' : 'row',
        alignItems: 'center',
        gap: 0,
        width: '100%',
        justifyContent: 'center',
      }}>
        {/* Left */}
        <div style={{
          flex: isPortrait ? undefined : 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          opacity: progress,
          transform: isPortrait
            ? `translateY(${(1 - progress) * -40}px)`
            : `translateX(${(1 - progress) * -40}px)`,
        }}>
          <div style={{
            color: '#ffffff',
            fontSize: valueFontSize,
            fontWeight: 900,
            letterSpacing: '-0.03em',
            lineHeight: 1,
            textAlign: 'center',
          }}>
            {leftValue}
          </div>
          <div style={{
            color: 'rgba(255,255,255,0.5)',
            fontSize: labelFontSize,
            marginTop: Math.round(16 * scale),
            textAlign: 'center',
            padding: `0 ${safeMargin}px`,
          }}>
            {leftLabel}
          </div>
        </div>

        {/* VS */}
        <div style={{
          color: accentColor,
          fontSize: vsFontSize,
          fontWeight: 900,
          letterSpacing: '-0.02em',
          padding: isPortrait ? `${Math.round(40 * scale)}px 0` : `0 ${Math.round(32 * scale)}px`,
          transform: `scale(${vsScaleAnim})`,
          textShadow: 'none',
        }}>
          VS
        </div>

        {/* Right */}
        <div style={{
          flex: isPortrait ? undefined : 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          opacity: progress,
          transform: isPortrait
            ? `translateY(${(1 - progress) * 40}px)`
            : `translateX(${(1 - progress) * 40}px)`,
        }}>
          <div style={{
            color: '#ffffff',
            fontSize: valueFontSize,
            fontWeight: 900,
            letterSpacing: '-0.03em',
            lineHeight: 1,
            textAlign: 'center',
          }}>
            {rightValue}
          </div>
          <div style={{
            color: 'rgba(255,255,255,0.5)',
            fontSize: labelFontSize,
            marginTop: Math.round(16 * scale),
            textAlign: 'center',
            padding: `0 ${safeMargin}px`,
          }}>
            {rightLabel}
          </div>
        </div>
      </div>
    </div>
  );
}
