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
  const padL = Math.round((isPortrait ? 100 : 140) * scale);
  const padR = Math.round((isPortrait ? 60 : 100) * scale);
  const padT = Math.round((isPortrait ? 120 : 160) * scale);
  const padB = Math.round((isPortrait ? 120 : 160) * scale);
  const chartW = W - padL - padR;
  // In portrait, let chart use up to 1.4x width for height so it fills the tall frame
  const chartH = Math.min(H - padT - padB, isPortrait ? Math.round(W * 1.4) : H - padT - padB);

  const values = dataPoints.map((p) => p.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const vRange = maxV - minV || 1;

  // In portrait, center the chart area vertically
  const chartTop = isPortrait ? Math.round((H - chartH) / 2) : padT;

  const pts = dataPoints.map((p, i) => ({
    x: padL + (i / (dataPoints.length - 1 || 1)) * chartW,
    y: chartTop + chartH - ((p.value - minV) / vRange) * chartH,
    label: p.label,
    value: p.value,
  }));

  // Build SVG polyline for drawProgress
  // We interpolate along the polyline
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
          top: chartTop - Math.round((isPortrait ? 80 : 60) * scale),
          left: padL,
          right: padR,
          color: 'rgba(255,255,255,0.85)',
          fontSize: Math.round((isPortrait ? 48 : 44) * scale),
          fontWeight: 700,
          textAlign: 'center',
        }}>
          {title}
        </div>
      )}

      <svg width={W} height={H} style={{ position: 'absolute', top: 0, left: 0 }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const y = chartTop + frac * chartH;
          const val = maxV - frac * vRange;
          return (
            <g key={frac}>
              <line x1={padL} y1={y} x2={padL + chartW} y2={y}
                stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
              <text x={padL - Math.round(12 * scale)} y={y + 5} textAnchor="end"
                fill="rgba(255,255,255,0.35)" fontSize={Math.round((isPortrait ? 26 : 22) * scale)}>
                {val >= 1000 ? `${(val / 1000).toFixed(0)}k` : Math.round(val)}
              </text>
            </g>
          );
        })}

        {/* Line */}
        {polylineStr && (
          <polyline
            points={polylineStr}
            fill="none"
            stroke={accentColor}
            strokeWidth={Math.round((isPortrait ? 6 : 5) * scale)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Area fill */}
        {polyPts.length > 1 && (
          <polygon
            points={`${polylineStr} ${polyPts[polyPts.length - 1].x},${chartTop + chartH} ${polyPts[0].x},${chartTop + chartH}`}
            fill={accentColor}
            opacity={0.12}
          />
        )}

        {/* Data points */}
        {pts.map((p, i) => {
          const visible = i <= visibleCount;
          if (!visible) return null;
          const dotOpacity = interpolate(visibleCount, [i - 0.3, i], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
          return (
            <g key={i} opacity={dotOpacity}>
              <circle cx={p.x} cy={p.y} r={Math.round((isPortrait ? 12 : 10) * scale)} fill={accentColor} />
              <text x={p.x} y={p.y - Math.round((isPortrait ? 24 : 20) * scale)} textAnchor="middle"
                fill="#fff" fontSize={Math.round((isPortrait ? 26 : 22) * scale)} fontWeight={700}>
                {p.value >= 1000 ? `${(p.value / 1000).toFixed(0)}k` : p.value}
              </text>
              {/* Label below x-axis */}
              <text x={p.x} y={chartTop + chartH + Math.round((isPortrait ? 56 : 48) * scale)} textAnchor="middle"
                fill="rgba(255,255,255,0.55)" fontSize={Math.round((isPortrait ? 28 : 24) * scale)}>
                {p.label}
              </text>
            </g>
          );
        })}
      </svg>

      {sourceLabel && (
        <div style={{
          position: 'absolute',
          top: chartTop + chartH + Math.round(80 * scale),
          left: padL,
          right: padR,
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
