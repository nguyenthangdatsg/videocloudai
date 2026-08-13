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
  const fadeIn = interpolate(frame, [0, Math.min(fps * 0.3, 7)], [0, 1], { extrapolateRight: 'clamp' });

  // Staggered animations
  const labelFade = interpolate(frame, [0, Math.min(fps * 0.4, 10)], [0, 1], { extrapolateRight: 'clamp' });
  const numberScale = interpolate(frame, [0, Math.min(fps * 0.5, 12)], [0.85, 1], {
    easing: Easing.out(Easing.back(1.2)),
    extrapolateRight: 'clamp',
  });
  const lineWidth = interpolate(frame, [Math.min(fps * 0.3, 7), Math.min(fps * 0.8, 20)], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const sourceFade = interpolate(frame, [Math.min(fps * 0.6, 15), Math.min(fps * 1.0, 24)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const accentAlpha = (a: number) => {
    const hex = accentColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  };

  const safeMargin = Math.round(Math.min(W, H) * 0.08);
  const valueFontSize = Math.round((isPortrait ? 200 : 240) * scale);
  const prefixFontSize = Math.round((isPortrait ? 80 : 100) * scale);
  const labelFontSize = Math.round((isPortrait ? 30 : 34) * scale);
  const sourceFontSize = Math.round((isPortrait ? 20 : 24) * scale);
  const underlineW = Math.round(160 * scale * lineWidth);
  const underlineH = Math.round(5 * scale);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: `radial-gradient(ellipse at 50% 50%, ${accentAlpha(0.06)} 0%, ${bgColor} 70%)`,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
      opacity: fadeIn,
      overflow: 'hidden',
    }}>
      {/* Label above */}
      {label && (
        <p style={{
          color: 'rgba(255,255,255,0.55)',
          fontSize: labelFontSize,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          marginBottom: Math.round(28 * scale),
          textAlign: 'center',
          padding: `0 ${safeMargin}px`,
          opacity: labelFade,
          transform: `translateY(${(1 - labelFade) * -16}px)`,
        }}>
          {label}
        </p>
      )}

      {/* Big number */}
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: Math.round(8 * scale),
        padding: `0 ${safeMargin}px`,
        transform: `scale(${numberScale})`,
        opacity: progress > 0 ? 1 : 0,
      }}>
        {prefix && (
          <span style={{
            color: accentColor,
            fontSize: prefixFontSize,
            fontWeight: 700,
            textShadow: `0 0 ${Math.round(20 * scale)}px ${accentAlpha(0.3)}`,
          }}>{prefix}</span>
        )}
        <span style={{
          color: '#ffffff',
          fontSize: valueFontSize,
          fontWeight: 900,
          lineHeight: 1,
          letterSpacing: '-0.04em',
          fontVariantNumeric: 'tabular-nums',
          textShadow: `0 0 ${Math.round(40 * scale)}px ${accentAlpha(0.15)}`,
        } as React.CSSProperties}>
          {formatNumber(displayValue)}
        </span>
        {suffix && (
          <span style={{
            color: accentColor,
            fontSize: prefixFontSize,
            fontWeight: 700,
            textShadow: `0 0 ${Math.round(20 * scale)}px ${accentAlpha(0.3)}`,
          }}>{suffix}</span>
        )}
      </div>

      {/* Accent underline with glow */}
      <div style={{
        width: underlineW,
        height: underlineH,
        background: `linear-gradient(90deg, transparent, ${accentColor}, transparent)`,
        borderRadius: underlineH,
        marginTop: Math.round(28 * scale),
        boxShadow: `0 0 ${Math.round(16 * scale)}px ${accentAlpha(0.5)}, 0 0 ${Math.round(40 * scale)}px ${accentAlpha(0.2)}`,
      }} />

      {/* Source */}
      {sourceLabel && (
        <p style={{
          color: 'rgba(255,255,255,0.3)',
          fontSize: sourceFontSize,
          fontWeight: 400,
          fontStyle: 'italic',
          marginTop: Math.round(28 * scale),
          textAlign: 'center',
          padding: `0 ${safeMargin}px`,
          opacity: sourceFade,
        }}>
          {sourceLabel}
        </p>
      )}
    </div>
  );
}
