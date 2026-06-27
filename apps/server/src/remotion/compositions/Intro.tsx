import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import type { IntroConfig } from '../types';

export function Intro({ creatorName, tagline, accentColor, style }: IntroConfig) {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, fps * 0.5], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.ease,
  });

  const fadeOut = interpolate(frame, [durationInFrames - fps * 0.4, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const slideUp = interpolate(frame, [fps * 0.3, fps * 0.9], [60, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const opacity = Math.min(fadeIn, fadeOut);
  const titleSize = style === 'bold' ? 96 : style === 'cinematic' ? 80 : 72;

  return (
    <AbsoluteFill style={{ backgroundColor: '#0a0a0f', opacity }}>
      {/* Top accent bar */}
      <div style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: style === 'cinematic' ? 2 : 4,
        backgroundColor: accentColor,
      }} />

      {/* Cinematic letterbox top */}
      {style === 'cinematic' && (
        <div style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 120,
          background: `linear-gradient(to bottom, ${accentColor}20, transparent)`,
        }} />
      )}

      <AbsoluteFill style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 28,
        padding: '0 80px',
      }}>
        {/* Creator name */}
        <div style={{
          color: 'white',
          fontSize: titleSize,
          fontWeight: 700,
          fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
          textAlign: 'center',
          transform: `translateY(${slideUp}px)`,
          textShadow: `0 0 60px ${accentColor}50`,
          lineHeight: 1.1,
          letterSpacing: style === 'bold' ? '-2px' : '0px',
        }}>
          {creatorName}
        </div>

        {/* Accent divider */}
        <div style={{
          width: style === 'bold' ? 100 : 60,
          height: 3,
          backgroundColor: accentColor,
          borderRadius: 2,
          transform: `translateY(${slideUp * 0.6}px)`,
        }} />

        {/* Tagline */}
        {tagline && (
          <div style={{
            color: '#9898b0',
            fontSize: 36,
            fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
            textAlign: 'center',
            transform: `translateY(${slideUp * 1.2}px)`,
            letterSpacing: '2px',
            textTransform: 'uppercase',
          }}>
            {tagline}
          </div>
        )}
      </AbsoluteFill>

      {/* Bottom accent bar */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: style === 'cinematic' ? 2 : 4,
        backgroundColor: accentColor,
      }} />
    </AbsoluteFill>
  );
}
