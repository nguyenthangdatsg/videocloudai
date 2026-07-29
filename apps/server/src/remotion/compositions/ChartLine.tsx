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
  } = props;

  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const holdAt = Math.floor(durationInFrames * 0.55);

  const drawProgress = interpolate(frame, [0, holdAt], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateRight: 'clamp',
  });

  const fadeIn = interpolate(frame, [0, Math.min(fps * 0.3, 7)], [0, 1], { extrapolateRight: 'clamp' });

  if (!dataPoints || dataPoints.length === 0) {
    return <div style={{ width: '100%', height: '100%', background: bgColor }} />;
  }

  const W = 1920;
  const H = 1080;
  const padL = 140;
  const padR = 100;
  const padT = 160;
  const padB = 160;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const values = dataPoints.map((p) => p.value);
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const vRange = maxV - minV || 1;

  const pts = dataPoints.map((p, i) => ({
    x: padL + (i / (dataPoints.length - 1 || 1)) * chartW,
    y: padT + chartH - ((p.value - minV) / vRange) * chartH,
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
          top: 48,
          left: padL,
          right: padR,
          color: 'rgba(255,255,255,0.85)',
          fontSize: 44,
          fontWeight: 700,
          textAlign: 'center',
        }}>
          {title}
        </div>
      )}

      <svg width={W} height={H} style={{ position: 'absolute', top: 0, left: 0 }}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
          const y = padT + frac * chartH;
          const val = maxV - frac * vRange;
          return (
            <g key={frac}>
              <line x1={padL} y1={y} x2={padL + chartW} y2={y}
                stroke="rgba(255,255,255,0.08)" strokeWidth={1} />
              <text x={padL - 12} y={y + 5} textAnchor="end"
                fill="rgba(255,255,255,0.35)" fontSize={22}>
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
            strokeWidth={5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        {/* Area fill */}
        {polyPts.length > 1 && (
          <polygon
            points={`${polylineStr} ${polyPts[polyPts.length - 1].x},${padT + chartH} ${polyPts[0].x},${padT + chartH}`}
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
              <circle cx={p.x} cy={p.y} r={10} fill={accentColor} />
              <text x={p.x} y={p.y - 20} textAnchor="middle"
                fill="#fff" fontSize={22} fontWeight={700}>
                {p.value >= 1000 ? `${(p.value / 1000).toFixed(0)}k` : p.value}
              </text>
              {/* Label below x-axis */}
              <text x={p.x} y={padT + chartH + 48} textAnchor="middle"
                fill="rgba(255,255,255,0.55)" fontSize={24}>
                {p.label}
              </text>
            </g>
          );
        })}
      </svg>

      {sourceLabel && (
        <div style={{
          position: 'absolute',
          bottom: 36,
          left: padL,
          right: padR,
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
