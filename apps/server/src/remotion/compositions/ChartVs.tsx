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

  const fadeIn = interpolate(frame, [0, Math.min(fps * 0.3, 7)], [0, 1], { extrapolateRight: 'clamp' });

  // Staggered entrance: left first, then VS, then right
  const leftSlide = interpolate(frame, [0, Math.min(fps * 0.5, 12)], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateRight: 'clamp',
  });
  const vsAnim = interpolate(frame, [Math.min(fps * 0.2, 5), Math.min(fps * 0.6, 15)], [0, 1], {
    easing: Easing.out(Easing.back(1.8)),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const rightSlide = interpolate(frame, [Math.min(fps * 0.15, 4), Math.min(fps * 0.65, 16)], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const titleFade = interpolate(frame, [0, Math.min(fps * 0.4, 10)], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const sourceFade = interpolate(frame, [Math.min(fps * 0.6, 15), Math.min(fps * 1.0, 24)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  // Divider line grow animation
  const lineGrow = interpolate(frame, [Math.min(fps * 0.1, 3), Math.min(fps * 0.5, 12)], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Detect if values are numeric (short) or descriptive text (long)
  const isNumeric = (v: string) => /^[\$\u20AC\u00A3\u00A5]?[\d,.\-\s]+[%kKmMbB]?$/.test(v.trim()) || v.trim().length <= 12;
  const numericMode = isNumeric(leftValue) && isNumeric(rightValue);

  const safeMargin = Math.round(Math.min(W, H) * 0.08);
  const headingFontSize = Math.round((isPortrait ? 64 : 76) * scale);
  const descFontSize = Math.round((isPortrait ? 26 : 30) * scale);
  const valueFontSize = Math.round((isPortrait ? 80 : 96) * scale);
  const labelFontSize = Math.round((isPortrait ? 30 : 34) * scale);
  const titleFontSize = Math.round((isPortrait ? 32 : 36) * scale);
  const sourceFontSize = Math.round((isPortrait ? 22 : 26) * scale);
  const vsFontSize = Math.round((isPortrait ? 52 : 64) * scale);

  const leftMain = numericMode ? leftValue : leftLabel;
  const leftSub = numericMode ? leftLabel : leftValue;
  const rightMain = numericMode ? rightValue : rightLabel;
  const rightSub = numericMode ? rightLabel : rightValue;
  const mainFontSize = numericMode ? valueFontSize : headingFontSize;
  const subFontSize = numericMode ? labelFontSize : descFontSize;

  // Accent color with alpha helper
  const accentAlpha = (a: number) => {
    const hex = accentColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  };

  const dividerThick = Math.round(3 * scale);
  const dividerLen = isPortrait
    ? Math.round(W * 0.5 * lineGrow)
    : Math.round(H * 0.45 * lineGrow);

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
      {/* Title */}
      {title && (
        <p style={{
          color: 'rgba(255,255,255,0.55)',
          fontSize: titleFontSize,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.12em',
          marginBottom: Math.round((isPortrait ? 56 : 44) * scale),
          textAlign: 'center',
          padding: `0 ${safeMargin}px`,
          opacity: titleFade,
          transform: `translateY(${(1 - titleFade) * -20}px)`,
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
        position: 'relative',
      }}>
        {/* Left side */}
        <div style={{
          flex: isPortrait ? undefined : 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          opacity: leftSlide,
          transform: isPortrait
            ? `translateY(${(1 - leftSlide) * -50}px)`
            : `translateX(${(1 - leftSlide) * -60}px)`,
        }}>
          <div style={{
            color: '#ffffff',
            fontSize: mainFontSize,
            fontWeight: 900,
            letterSpacing: '-0.03em',
            lineHeight: 1.1,
            textAlign: 'center',
            padding: `0 ${safeMargin}px`,
          }}>
            {leftMain}
          </div>
          <div style={{
            color: 'rgba(255,255,255,0.4)',
            fontSize: subFontSize,
            fontWeight: 500,
            marginTop: Math.round(14 * scale),
            textAlign: 'center',
            padding: `0 ${safeMargin}px`,
            lineHeight: 1.4,
          }}>
            {leftSub}
          </div>
        </div>

        {/* VS badge + divider */}
        <div style={{
          display: 'flex',
          flexDirection: isPortrait ? 'column' : 'row',
          alignItems: 'center',
          justifyContent: 'center',
          padding: isPortrait ? `${Math.round(28 * scale)}px 0` : `0 ${Math.round(20 * scale)}px`,
          position: 'relative',
        }}>
          {/* Divider line before */}
          <div style={{
            background: `linear-gradient(${isPortrait ? '0deg' : '90deg'}, transparent, ${accentAlpha(0.5)})`,
            ...(isPortrait
              ? { width: dividerLen, height: dividerThick, marginBottom: Math.round(12 * scale) }
              : { height: dividerLen, width: dividerThick, marginRight: Math.round(12 * scale) }),
            borderRadius: dividerThick,
          }} />

          {/* VS text */}
          <div style={{
            color: '#ffffff',
            fontSize: vsFontSize,
            fontWeight: 900,
            letterSpacing: '0.05em',
            transform: `scale(${vsAnim})`,
            opacity: vsAnim,
            background: accentColor,
            padding: `${Math.round(8 * scale)}px ${Math.round(20 * scale)}px`,
            borderRadius: Math.round(12 * scale),
            boxShadow: `0 0 ${Math.round(30 * scale)}px ${accentAlpha(0.4)}, 0 0 ${Math.round(60 * scale)}px ${accentAlpha(0.15)}`,
          }}>
            VS
          </div>

          {/* Divider line after */}
          <div style={{
            background: `linear-gradient(${isPortrait ? '180deg' : '270deg'}, transparent, ${accentAlpha(0.5)})`,
            ...(isPortrait
              ? { width: dividerLen, height: dividerThick, marginTop: Math.round(12 * scale) }
              : { height: dividerLen, width: dividerThick, marginLeft: Math.round(12 * scale) }),
            borderRadius: dividerThick,
          }} />
        </div>

        {/* Right side */}
        <div style={{
          flex: isPortrait ? undefined : 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          opacity: rightSlide,
          transform: isPortrait
            ? `translateY(${(1 - rightSlide) * 50}px)`
            : `translateX(${(1 - rightSlide) * 60}px)`,
        }}>
          <div style={{
            color: '#ffffff',
            fontSize: mainFontSize,
            fontWeight: 900,
            letterSpacing: '-0.03em',
            lineHeight: 1.1,
            textAlign: 'center',
            padding: `0 ${safeMargin}px`,
          }}>
            {rightMain}
          </div>
          <div style={{
            color: 'rgba(255,255,255,0.4)',
            fontSize: subFontSize,
            fontWeight: 500,
            marginTop: Math.round(14 * scale),
            textAlign: 'center',
            padding: `0 ${safeMargin}px`,
            lineHeight: 1.4,
          }}>
            {rightSub}
          </div>
        </div>
      </div>

      {/* Source label */}
      {sourceLabel && (
        <p style={{
          color: 'rgba(255,255,255,0.3)',
          fontSize: sourceFontSize,
          fontWeight: 400,
          fontStyle: 'italic',
          marginTop: Math.round((isPortrait ? 56 : 44) * scale),
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
