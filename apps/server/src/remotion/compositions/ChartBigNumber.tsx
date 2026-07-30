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
  const { fps } = useVideoConfig();
  const holdAt = animationFrames ?? Math.floor(durationInFrames * 0.95);

  const progress = interpolate(frame, [0, holdAt], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateRight: 'clamp',
  });

  const displayValue = value * progress;
  const opacity = interpolate(frame, [0, Math.min(fps * 0.3, 7)], [0, 1], { extrapolateRight: 'clamp' });

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
          fontSize: 42,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          marginBottom: 24,
          textAlign: 'center',
          padding: '0 60px',
        }}>
          {label}
        </p>
      )}

      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 8,
      }}>
        {prefix && (
          <span style={{ color: accentColor, fontSize: 64, fontWeight: 700 }}>{prefix}</span>
        )}
        <span style={{
          color: '#ffffff',
          fontSize: 160,
          fontWeight: 900,
          lineHeight: 1,
          letterSpacing: '-0.04em',
          tabularNums: 'proportional-nums',
          fontVariantNumeric: 'tabular-nums',
        } as React.CSSProperties}>
          {formatNumber(displayValue)}
        </span>
        {suffix && (
          <span style={{ color: accentColor, fontSize: 64, fontWeight: 700 }}>{suffix}</span>
        )}
      </div>

      <div style={{
        width: 80,
        height: 4,
        background: accentColor,
        borderRadius: 2,
        marginTop: 32,
        opacity: progress,
      }} />

      {sourceLabel && (
        <p style={{
          color: 'rgba(255,255,255,0.35)',
          fontSize: 28,
          marginTop: 24,
          textAlign: 'center',
          padding: '0 60px',
        }}>
          {sourceLabel}
        </p>
      )}
    </div>
  );
}
