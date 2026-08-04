import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import type { ChartBigNumberConfig } from '../types';

function formatNumber(n: number): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (Math.abs(n) >= 1_000) return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (n !== Math.floor(n)) return n.toFixed(1);
  return String(Math.round(n));
}

export function ChartBigNumber(props: ChartBigNumberConfig) {
  const {
    value,
    prefix = '',
    suffix = '',
    label,
    sourceLabel,
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

  const displayValue = value * progress;
  const opacity = interpolate(frame, [0, Math.min(fps * 0.3, 7)], [0, 1], { extrapolateRight: 'clamp' });

  const safeMargin = Math.round(Math.min(W, H) * 0.08);
  const valueFontSize = Math.round((isPortrait ? 120 : 160) * scale);
  const prefixFontSize = Math.round((isPortrait ? 48 : 64) * scale);
  const labelFontSize = Math.round((isPortrait ? 36 : 42) * scale);
  const sourceFontSize = Math.round((isPortrait ? 24 : 28) * scale);

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
      opacity,
    }}>
      {label && (
        <p style={{
          color: 'rgba(255,255,255,0.6)',
          fontSize: labelFontSize,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          marginBottom: Math.round(24 * scale),
          textAlign: 'center',
          padding: `0 ${safeMargin}px`,
        }}>
          {label}
        </p>
      )}

      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: Math.round(8 * scale),
        padding: `0 ${safeMargin}px`,
      }}>
        {prefix && (
          <span style={{ color: accentColor, fontSize: prefixFontSize, fontWeight: 700 }}>{prefix}</span>
        )}
        <span style={{
          color: '#ffffff',
          fontSize: valueFontSize,
          fontWeight: 900,
          lineHeight: 1,
          letterSpacing: '-0.04em',
          fontVariantNumeric: 'tabular-nums',
        } as React.CSSProperties}>
          {formatNumber(displayValue)}
        </span>
        {suffix && (
          <span style={{ color: accentColor, fontSize: prefixFontSize, fontWeight: 700 }}>{suffix}</span>
        )}
      </div>

      <div style={{
        width: Math.round(80 * scale),
        height: Math.round(4 * scale),
        background: accentColor,
        borderRadius: Math.round(2 * scale),
        marginTop: Math.round(32 * scale),
        opacity: progress,
      }} />

      {sourceLabel && (
        <p style={{
          color: 'rgba(255,255,255,0.35)',
          fontSize: sourceFontSize,
          marginTop: Math.round(24 * scale),
          textAlign: 'center',
          padding: `0 ${safeMargin}px`,
        }}>
          {sourceLabel}
        </p>
      )}
    </div>
  );
}
