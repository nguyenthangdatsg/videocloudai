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
  } = props;

  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const holdAt = Math.floor(durationInFrames * 0.55);

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

  const barH = 54;
  const barGap = 20;
  const totalH = itemCount * (barH + barGap) - barGap;
  const padL = 320;
  const padR = 140;
  const barMaxW = 1920 - padL - padR;
  const startY = (1080 - totalH) / 2 - (title ? 40 : 0);

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
          top: 48,
          left: 0,
          right: 0,
          color: 'rgba(255,255,255,0.85)',
          fontSize: 44,
          fontWeight: 700,
          textAlign: 'center',
        }}>
          {title}
        </div>
      )}

      <svg width={1920} height={1080} style={{ position: 'absolute', top: 0, left: 0 }}>
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

          return (
            <g key={i}>
              {/* Bar */}
              <rect
                x={padL}
                y={y}
                width={Math.max(barW, 0)}
                height={barH}
                rx={6}
                fill={isTop ? accentColor : `${accentColor}99`}
              />
              {/* Name */}
              <text
                x={padL - 16}
                y={y + barH / 2 + 8}
                textAnchor="end"
                fill="rgba(255,255,255,0.8)"
                fontSize={26}
                fontWeight={isTop ? 700 : 400}
              >
                {bar.name.length > 20 ? bar.name.slice(0, 20) + '…' : bar.name}
              </text>
              {/* Value */}
              {barProgress > 0.3 && (
                <text
                  x={padL + barW + 12}
                  y={y + barH / 2 + 8}
                  textAnchor="start"
                  fill={isTop ? accentColor : 'rgba(255,255,255,0.6)'}
                  fontSize={26}
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
          bottom: 36,
          left: 0,
          right: 0,
          color: 'rgba(255,255,255,0.3)',
          fontSize: 26,
          textAlign: 'center',
        }}>
          {sourceLabel}
        </div>
      )}
    </div>
  );
}
