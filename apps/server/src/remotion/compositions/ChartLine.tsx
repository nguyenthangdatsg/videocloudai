import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import type { ChartLineConfig } from '../types';

export function ChartLine(props: ChartLineConfig) {
  const {
    dataPoints,
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

  const drawProgress = interpolate(frame, [0, holdAt], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateRight: 'clamp',
  });

  const fadeIn = interpolate(frame, [0, Math.min(fps * 0.3, 7)], [0, 1], { extrapolateRight: 'clamp' });

  if (!dataPoints || dataPoints.length === 0) {
    return <div style={{ width: '100%', height: '100%', background: bgColor }} />;
  }

  const isPortrait = H > W;
  const scale = Math.min(W, H) / 1080;
  const safeMargin = Math.round(Math.min(W, H) * 0.08);
  const padL = Math.max(Math.round((isPortrait ? 100 : 140) * scale), safeMargin);
  const padR = Math.max(Math.round((isPortrait ? 80 : 100) * scale), safeMargin);
  const padT = Math.max(Math.round((isPortrait ? 120 : 160) * scale), safeMargin);
  const padB = Math.max(Math.round((isPortrait ? 120 : 160) * scale), safeMargin);
  const chartW = W - padL - padR;
  const chartH = Math.min(H - padT - padB, isPortrait ? Math.round(W * 1.2) : H - padT - padB);

  const values = dataPoints.map((p) => p.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const vRange = maxV - minV || 1;

  const chartTop = isPortrait ? Math.round((H - chartH) / 2) : padT;

  const pts = dataPoints.map((p, i) => ({
    x: padL + (i / (dataPoints.length - 1 || 1)) * chartW,
    y: chartTop + chartH - ((p.value - minV) / vRange) * chartH,
    label: p.label,
    value: p.value,
  }));

  const totalPts = pts.length;
  const visibleCount = drawProgress * (totalPts - 1);

  const polyPts: { x: number; y: number }[] = [];
  for (let i = 0; i < totalPts; i++) {
    if (i <= Math.floor(visibleCount)) {
      polyPts.push(pts[i]);
    } else if (i === Math.ceil(visibleCount) && visibleCount > Math.floor(visibleCount)) {
      const frac = visibleCount - Math.floor(visibleCount);
      polyPts.push({
        x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * frac,
        y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * frac,
      });
      break;
    }
  }

  const polylineStr = polyPts.map((p) => `${p.x},${p.y}`).join(' ');

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

  const lineStroke = Math.round((isPortrait ? 5 : 4) * scale);
  const dotR = Math.round((isPortrait ? 10 : 8) * scale);
  const dotRInner = Math.round((isPortrait ? 5 : 4) * scale);
  const fontSize = Math.round((isPortrait ? 24 : 20) * scale);
  const labelFont = Math.round((isPortrait ? 22 : 20) * scale);
  const gridFont = Math.round((isPortrait ? 22 : 20) * scale);

  // Area fill polygon string
  const areaStr = polyPts.length > 1
    ? `${polylineStr} ${polyPts[polyPts.length - 1].x},${chartTop + chartH} ${polyPts[0].x},${chartTop + chartH}`
    : '';

  const gradId = 'areaGrad';

  return (
    <div style={{
      width: '100%',
      height: '100%',
      background: `radial-gradient(ellipse at 50% 60%, ${accentAlpha(0.04)} 0%, ${bgColor} 70%)`,
      fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
      opacity: fadeIn,
      overflow: 'hidden',
    }}>
      {/* Title */}
      {title && (
        <div style={{
          position: 'absolute',
          top: chartTop - Math.round((isPortrait ? 80 : 60) * scale),
          left: padL,
          right: padR,
          color: 'rgba(255,255,255,0.85)',
          fontSize: Math.round((isPortrait ? 44 : 40) * scale),
          fontWeight: 700,
          textAlign: 'center',
          opacity: titleFade,
          transform: `translateY(${(1 - titleFade) * -16}px)`,
        }}>
          {title}
        </div>
      )}

      <svg width={W} height={H} style={{ position: 'absolute', top: 0, left: 0 }}>
        <defs>
          {/* Vertical gradient for area fill */}
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accentColor} stopOpacity={0.25} />
            <stop offset="100%" stopColor={accentColor} stopOpacity={0.02} />
          </linearGradient>
          {/* Glow filter for the line */}
          <filter id="lineGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation={Math.round(4 * scale)} result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const y = chartTop + frac * chartH;
          const val = maxV - frac * vRange;
          return (
            <g key={frac}>
              <line x1={padL} y1={y} x2={padL + chartW} y2={y}
                stroke="rgba(255,255,255,0.06)" strokeWidth={1} strokeDasharray={`${Math.round(4 * scale)} ${Math.round(4 * scale)}`} />
              <text x={padL - Math.round(12 * scale)} y={y + gridFont * 0.35} textAnchor="end"
                fill="rgba(255,255,255,0.3)" fontSize={gridFont} fontWeight={400}>
                {val >= 1000 ? `${(val / 1000).toFixed(0)}k` : Math.round(val)}
              </text>
            </g>
          );
        })}

        {/* Area fill with gradient */}
        {areaStr && (
          <polygon
            points={areaStr}
            fill={`url(#${gradId})`}
          />
        )}

        {/* Line with glow */}
        {polylineStr && (
          <>
            {/* Glow shadow line */}
            <polyline
              points={polylineStr}
              fill="none"
              stroke={accentAlpha(0.4)}
              strokeWidth={lineStroke + Math.round(4 * scale)}
              strokeLinecap="round"
              strokeLinejoin="round"
              filter="url(#lineGlow)"
            />
            {/* Main line */}
            <polyline
              points={polylineStr}
              fill="none"
              stroke={accentColor}
              strokeWidth={lineStroke}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        )}

        {/* Data points */}
        {pts.map((p, i) => {
          const visible = i <= visibleCount;
          if (!visible) return null;
          const dotOpacity = interpolate(visibleCount, [i - 0.3, i], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          const dotScale = interpolate(visibleCount, [i - 0.3, i], [0.5, 1], {
            easing: Easing.out(Easing.back(1.5)),
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          return (
            <g key={i} opacity={dotOpacity} transform={`translate(${p.x}, ${p.y}) scale(${dotScale}) translate(${-p.x}, ${-p.y})`}>
              {/* Outer ring */}
              <circle cx={p.x} cy={p.y} r={dotR} fill={accentAlpha(0.15)} stroke={accentColor} strokeWidth={Math.round(2 * scale)} />
              {/* Inner dot */}
              <circle cx={p.x} cy={p.y} r={dotRInner} fill={accentColor} />
              {/* Value above */}
              <text x={p.x} y={p.y - Math.round((isPortrait ? 20 : 16) * scale)} textAnchor="middle"
                fill="#fff" fontSize={fontSize} fontWeight={700}>
                {p.value >= 1000 ? `${(p.value / 1000).toFixed(0)}k` : p.value}
              </text>
              {/* Label below x-axis */}
              <text x={p.x} y={chartTop + chartH + Math.round((isPortrait ? 48 : 40) * scale)} textAnchor="middle"
                fill="rgba(255,255,255,0.45)" fontSize={labelFont} fontWeight={500}>
                {p.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Source */}
      {sourceLabel && (
        <div style={{
          position: 'absolute',
          top: chartTop + chartH + Math.round(80 * scale),
          left: padL,
          right: padR,
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
