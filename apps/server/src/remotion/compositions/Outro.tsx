import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import type { OutroConfig } from '../types';

export function Outro({ creatorName, socialHandle, ctaText, accentColor }: OutroConfig) {
  const frame = useCurrentFrame();
  const { durationInFrames, fps } = useVideoConfig();

  const fadeIn = interpolate(frame, [0, fps * 0.4], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.ease,
  });

  const fadeOut = interpolate(frame, [durationInFrames - fps * 0.5, durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const slideUp = interpolate(frame, [fps * 0.2, fps * 0.7], [60, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });

  const opacity = Math.min(fadeIn, fadeOut);

  return (
    <AbsoluteFill style={{ backgroundColor: '#0a0a0f', opacity }}>
      {/* Background gradient */}
      <AbsoluteFill style={{
        background: `radial-gradient(ellipse at center, ${accentColor}15 0%, transparent 70%)`,
      }} />

      <AbsoluteFill style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 32,
        padding: '0 80px',
      }}>
        {/* CTA text */}
        <div style={{
          color: 'white',
          fontSize: 60,
          fontWeight: 700,
          fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
          textAlign: 'center',
          transform: `translateY(${slideUp}px)`,
          lineHeight: 1.2,
        }}>
          {ctaText}
        </div>

        {/* Accent divider */}
        <div style={{
          width: 60,
          height: 3,
          backgroundColor: accentColor,
          borderRadius: 2,
          transform: `translateY(${slideUp * 0.8}px)`,
        }} />

        {/* Creator name */}
        <div style={{
          color: accentColor,
          fontSize: 52,
          fontWeight: 600,
          fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
          textAlign: 'center',
          transform: `translateY(${slideUp * 0.7}px)`,
          textShadow: `0 0 40px ${accentColor}60`,
        }}>
          {creatorName}
        </div>

        {/* Social handle */}
        {socialHandle && (
          <div style={{
            color: '#9898b0',
            fontSize: 38,
            fontFamily: 'system-ui, -apple-system, Arial, sans-serif',
            textAlign: 'center',
            transform: `translateY(${slideUp * 0.5}px)`,
            letterSpacing: '1px',
          }}>
            {socialHandle}
          </div>
        )}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}
