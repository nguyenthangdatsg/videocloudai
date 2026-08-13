import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import type { ChartBarsConfig } from '../types';

export function ChartBars(props: ChartBarsConfig) {
  const {
    bars,
    title,
    sourceLabel,
    accentColor = '#7c6af5',
    bgColor = '#0d0e12',
    sortOrder = 'scripted',
    durationInFrames,
    animationFrames,
  } = props;

  const frame = useCurrentFrame();
  const { fps, width: W, height: H } = useVideoConfig();
  const holdAt = animationFrames ?? Math.floor(durationInFrames * 0.95);

  const progress = interpolate(frame, [0, holdAt], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateRight: 'clamp',
  });

  const fadeIn = interpolate(frame, [0, Math.min(fps * 0.3, 7)], [0, 1], { extrapolateRight: 'clamp' });

  if (!bars || bars.length === 0) {
    return <div style={{ width: '100%', height: '100%', background: bgColor }} />;
  }

  const sorted = [...bars];
  if (sortOrder === 'asc') sorted.sort((a, b) => a.value - b.value);
  else if (sortOrder === 'desc') sorted.sort((a, b) => b.value - a.value);

  const maxVal = Math.max(...sorted.map((b) => b.value), 1);
  const itemCount = Math.min(sorted.length, 10);
  const displayBars = sorted.slice(0, itemCount);

  const isPortrait = H > W;
  const scale = Math.min(W, H) / 1080;
  const safeMargin = Math.round(Math.min(W, H) * 0.08);
  const barH = Math.round((isPortrait ? 56 : 48) * scale);
  const barGap = Math.round((isPortrait ? 20 : 16) * scale);
  const totalH = itemCount * (barH + barGap) - barGap;
  const padL = Math.max(Math.round((isPortrait ? 200 : 320) * scale), safeMargin);
  const padR = Math.max(Math.round((isPortrait ? 100 : 140) * scale), safeMargin);
  const barMaxW = W - padL - padR;
  const titleReserve = title ? Math.round(100 * scale) : 0;
  const safeTop = Math.round(H * 0.06) + titleReserve;
  const safeBottom = Math.round(H * 0.06);
  const availableH = H - safeTop - safeBottom;
  const startY = safeTop + Math.max(0, (availableH - totalH) / 2);

  const accentAlpha = (a: number) => {
    const hex = accentColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  };

  const titleFade = interpolate(frame, [0, Math.min(fps * 0.4, 10)], [0, 1], { extrapolateRight: 'clamp' });
  const sourceFade = interpolate(frame, [Math.min(fps * 0.6, 15), Math.min(fps * 1.0, 24)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: `radial-gradient(ellipse at 30% 40%, ${accentAlpha(0.04)} 0%, ${bgColor} 70%)`,
      fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
      opacity: fadeIn,
      overflow: 'hidden',
    }}>
      {/* Title */}
      {title && (
        <div style={{
          position: 'absolute',
          top: startY - Math.round((isPortrait ? 80 : 60) * scale),
          left: 0,
          right: 0,
          color: 'rgba(255,255,255,0.85)',
          fontSize: Math.round((isPortrait ? 44 : 40) * scale),
          fontWeight: 700,
          textAlign: 'center',
          padding: `0 ${Math.round(40 * scale)}px`,
          opacity: titleFade,
          transform: `translateY(${(1 - titleFade) * -16}px)`,
        }}>
          {title}
        </div>
      )}

      <svg width={W} height={H} style={{ position: 'absolute', top: 0, left: 0 }}>
        <defs>
          {/* Gradient for top bar */}
          <linearGradient id="barGradTop" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={accentColor} />
            <stop offset="100%" stopColor={accentAlpha(0.7)} />
          </linearGradient>
          <linearGradient id="barGradNormal" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={accentAlpha(0.6)} />
            <stop offset="100%" stopColor={accentAlpha(0.3)} />
          </linearGradient>
        </defs>

        {/* Subtle horizontal grid lines */}
        {displayBars.map((_, i) => {
          const y = startY + i * (barH + barGap) + barH / 2;
          return (
            <line key={`grid-${i}`} x1={padL} y1={y} x2={padL + barMaxW} y2={y}
              stroke="rgba(255,255,255,0.04)" strokeWidth={1} />
          );
        })}

        {displayBars.map((bar, i) => {
          const y = startY + i * (barH + barGap);
          const barDelay = i * 0.08;
          const barProgress = interpolate(
            progress,
            [barDelay, Math.min(barDelay + 0.6, 1)],
            [0, 1],
            { easing: Easing.out(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
          );
          const barW = (bar.value / maxVal) * barMaxW * barProgress;
          const valStr = bar.value >= 1_000_000
            ? `${(bar.value / 1_000_000).toFixed(1)}M`
            : bar.value >= 1_000
              ? `${(bar.value / 1_000).toFixed(0)}k`
              : String(bar.value);

          const isTop = i === 0 && sortOrder !== 'asc';
          const fontSize = Math.round((isPortrait ? 26 : 24) * scale);
          const maxNameLen = isPortrait ? 14 : 20;
          const barRadius = Math.round(6 * scale);

          // Stagger fade for labels
          const labelOpacity = interpolate(
            progress,
            [barDelay, Math.min(barDelay + 0.3, 1)],
            [0, 1],
            { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
          );

          return (
            <g key={i}>
              {/* Bar with gradient */}
              <rect
                x={padL}
                y={y}
                width={Math.max(barW, 0)}
                height={barH}
                rx={barRadius}
                fill={isTop ? 'url(#barGradTop)' : 'url(#barGradNormal)'}
              />
              {/* Glow on top bar */}
              {isTop && barW > 0 && (
                <rect
                  x={padL}
                  y={y}
                  width={Math.max(barW, 0)}
                  height={barH}
                  rx={barRadius}
                  fill="none"
                  stroke={accentAlpha(0.3)}
                  strokeWidth={Math.round(2 * scale)}
                  filter="url(#none)"
                  style={{ filter: `drop-shadow(0 0 ${Math.round(8 * scale)}px ${accentAlpha(0.3)})` } as any}
                />
              )}
              {/* Name label */}
              <text
                x={padL - Math.round(16 * scale)}
                y={y + barH / 2 + fontSize * 0.35}
                textAnchor="end"
                fill={isTop ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.7)'}
                fontSize={fontSize}
                fontWeight={isTop ? 700 : 500}
                opacity={labelOpacity}
              >
                {bar.name.length > maxNameLen ? bar.name.slice(0, maxNameLen) + '\u2026' : bar.name}
              </text>
              {/* Value label */}
              {barProgress > 0.3 && (
                <text
                  x={padL + barW + Math.round(14 * scale)}
                  y={y + barH / 2 + fontSize * 0.35}
                  textAnchor="start"
                  fill={isTop ? accentColor : 'rgba(255,255,255,0.55)'}
                  fontSize={fontSize}
                  fontWeight={700}
                  opacity={barProgress}
                >
                  {valStr}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Source */}
      {sourceLabel && (
        <div style={{
          position: 'absolute',
          bottom: Math.round(80 * scale),
          left: 0,
          right: 0,
          color: 'rgba(255,255,255,0.25)',
          fontSize: Math.round(22 * scale),
          fontStyle: 'italic',
          textAlign: 'center',
          opacity: sourceFade,
        }}>
          {sourceLabel}
        </div>
      )}
    </div>
  );
}
