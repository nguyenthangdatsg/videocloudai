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

  // Scale dimensions proportionally to actual composition size
  const isPortrait = H > W;
  const scale = Math.min(W, H) / 1080;
  const safeMargin = Math.round(Math.min(W, H) * 0.08);
  const barH = Math.round((isPortrait ? 64 : 54) * scale);
  const barGap = Math.round((isPortrait ? 24 : 20) * scale);
  const totalH = itemCount * (barH + barGap) - barGap;
  const padL = Math.max(Math.round((isPortrait ? 200 : 320) * scale), safeMargin);
  const padR = Math.max(Math.round((isPortrait ? 100 : 140) * scale), safeMargin);
  const barMaxW = W - padL - padR;
  // Shift bars down to leave room for title within the cropped overlay area
  const titleReserve = title ? Math.round(100 * scale) : 0;
  const safeTop = Math.round(H * 0.06) + titleReserve;
  const safeBottom = Math.round(H * 0.06);
  const availableH = H - safeTop - safeBottom;
  const startY = safeTop + Math.max(0, (availableH - totalH) / 2);

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: bgColor,
      fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
      opacity: fadeIn,
    }}>
      {title && (
        <div style={{
          position: 'absolute',
          top: startY - Math.round((isPortrait ? 80 : 60) * scale),
          left: 0,
          right: 0,
          color: 'rgba(255,255,255,0.85)',
          fontSize: Math.round((isPortrait ? 48 : 44) * scale),
          fontWeight: 700,
          textAlign: 'center',
          padding: `0 ${Math.round(40 * scale)}px`,
        }}>
          {title}
        </div>
      )}

      <svg width={W} height={H} style={{ position: 'absolute', top: 0, left: 0 }}>
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
          const fontSize = Math.round((isPortrait ? 28 : 26) * scale);
          const maxNameLen = isPortrait ? 14 : 20;

          return (
            <g key={i}>
              {/* Bar */}
              <rect
                x={padL}
                y={y}
                width={Math.max(barW, 0)}
                height={barH}
                rx={Math.round(6 * scale)}
                fill={isTop ? accentColor : `${accentColor}99`}
              />
              {/* Name */}
              <text
                x={padL - Math.round(16 * scale)}
                y={y + barH / 2 + fontSize * 0.35}
                textAnchor="end"
                fill="rgba(255,255,255,0.8)"
                fontSize={fontSize}
                fontWeight={isTop ? 700 : 400}
              >
                {bar.name.length > maxNameLen ? bar.name.slice(0, maxNameLen) + '…' : bar.name}
              </text>
              {/* Value */}
              {barProgress > 0.3 && (
                <text
                  x={padL + barW + Math.round(12 * scale)}
                  y={y + barH / 2 + fontSize * 0.35}
                  textAnchor="start"
                  fill={isTop ? accentColor : 'rgba(255,255,255,0.6)'}
                  fontSize={fontSize}
                  fontWeight={700}
                >
                  {valStr}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {sourceLabel && (
        <div style={{
          position: 'absolute',
          bottom: Math.round(80 * scale),
          left: 0,
          right: 0,
          color: 'rgba(255,255,255,0.3)',
          fontSize: Math.round(26 * scale),
          textAlign: 'center',
        }}>
          {sourceLabel}
        </div>
      )}
    </div>
  );
}
