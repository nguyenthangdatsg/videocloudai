import React from 'react';
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  Video,
  Img,
  spring,
  interpolate,
} from 'remotion';
import type { ComparisonSceneConfig } from '../types';

export function ComparisonScene({
  leftMediaSrc,
  leftMediaType,
  leftName,
  leftScore,
  rightMediaSrc,
  rightMediaType,
  rightName,
  rightScore,
  mascotSrc,
  layout,
  activeSide,
  roundLabel,
  roundPanels,
  bgType,
  bgSrc,
  stickerSrc,
}: ComparisonSceneConfig) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Entrance spring animation for overlays
  const overlaySpring = spring({
    frame,
    fps,
    config: {
      damping: 12,
    },
  });

  // Scale overlay from 0 to 1
  const scale = interpolate(overlaySpring, [0, 1], [0.8, 1]);
  const opacity = interpolate(overlaySpring, [0, 1], [0, 1]);

  // Mascot animation: slight hover bounce using sine wave
  const bounceY = Math.sin(frame * 0.1) * 8; // ±8px bounce

  // Active side check
  const isWinLeft = activeSide === 'win-left';
  const isWinRight = activeSide === 'win-right';
  const dimLeft = activeSide === 'right' || isWinRight;
  const dimRight = activeSide === 'left' || isWinLeft;

  // Layout positions
  const L = layout?.left || { x: 0, y: 0, w: 50, h: 58 };
  const M = layout?.mascot || { x: 20, y: 58, w: 60, h: 42 };
  const R = layout?.right || { x: 50, y: 0, w: 50, h: 58 };

  const panelRadius = roundPanels ? '24px' : '0px';

  return (
    <AbsoluteFill style={{ backgroundColor: '#0d0e12', fontFamily: 'Arial, sans-serif' }}>
      {/* ── Background ── */}
      {bgType === 'color' && (
        <AbsoluteFill style={{ backgroundColor: bgSrc || '#0d0e12' }} />
      )}
      {bgType === 'image' && bgSrc && (
        <Img src={bgSrc} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      )}
      {bgType === 'video' && bgSrc && (
        <Video
          src={bgSrc}
          loop
          muted
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      )}

      {/* ── Left Comparison Panel ── */}
      <div
        style={{
          position: 'absolute',
          left: `${L.x}%`,
          top: `${L.y}%`,
          width: `${L.w}%`,
          height: `${L.h}%`,
          overflow: 'hidden',
          borderRadius: panelRadius,
          transition: 'all 0.5s ease',
          filter: dimLeft ? 'brightness(0.3)' : 'brightness(1.0)',
          border: isWinLeft ? '6px solid #ffd700' : 'none',
          boxShadow: isWinLeft ? '0 0 30px rgba(255,215,0,0.6)' : 'none',
          zIndex: isWinLeft ? 2 : 1,
        }}
      >
        {leftMediaType === 'video' && leftMediaSrc ? (
          <Video
            src={leftMediaSrc}
            loop
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          leftMediaSrc && (
            <Img src={leftMediaSrc} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          )
        )}
      </div>

      {/* ── Right Comparison Panel ── */}
      <div
        style={{
          position: 'absolute',
          left: `${R.x}%`,
          top: `${R.y}%`,
          width: `${R.w}%`,
          height: `${R.h}%`,
          overflow: 'hidden',
          borderRadius: panelRadius,
          transition: 'all 0.5s ease',
          filter: dimRight ? 'brightness(0.3)' : 'brightness(1.0)',
          border: isWinRight ? '6px solid #ffd700' : 'none',
          boxShadow: isWinRight ? '0 0 30px rgba(255,215,0,0.6)' : 'none',
          zIndex: isWinRight ? 2 : 1,
        }}
      >
        {rightMediaType === 'video' && rightMediaSrc ? (
          <Video
            src={rightMediaSrc}
            loop
            muted
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          rightMediaSrc && (
            <Img src={rightMediaSrc} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          )
        )}
      </div>

      {/* ── Center Mascot Overlay ── */}
      {mascotSrc && (
        <div
          style={{
            position: 'absolute',
            left: `${M.x}%`,
            top: `${M.y}%`,
            width: `${M.w}%`,
            height: `${M.h}%`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 3,
            transform: `scale(${scale}) translateY(${bounceY}px)`,
            opacity,
          }}
        >
          <Img
            src={mascotSrc}
            style={{
              maxHeight: '100%',
              maxWidth: '100%',
              objectFit: 'contain',
              filter: 'drop-shadow(0 10px 20px rgba(0,0,0,0.5))',
            }}
          />
        </div>
      )}

      {/* ── Top Score Pill Overlay ── */}
      {leftName && rightName && (
        <div
          style={{
            position: 'absolute',
            top: '2%',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <div
            style={{
              backgroundColor: 'rgba(10, 11, 14, 0.85)',
              border: '1.5px solid rgba(255, 255, 255, 0.15)',
              borderRadius: '999px',
              padding: '10px 28px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '16px',
              color: 'white',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              backdropFilter: 'blur(8px)',
            }}
          >
            <span style={{ fontSize: '20px', fontWeight: 'bold', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>
              {leftName}
            </span>
            <span
              style={{
                fontSize: '24px',
                fontWeight: 900,
                color: '#ffc107',
                backgroundColor: 'rgba(255,193,7,0.1)',
                padding: '4px 14px',
                borderRadius: '8px',
                border: '1px solid rgba(255,193,7,0.3)',
              }}
            >
              {leftScore} : {rightScore}
            </span>
            <span style={{ fontSize: '20px', fontWeight: 'bold', textShadow: '0 2px 4px rgba(0,0,0,0.5)' }}>
              {rightName}
            </span>
          </div>

          {/* ── Round Label ── */}
          {roundLabel && (
            <div
              style={{
                backgroundColor: 'rgba(255, 215, 0, 0.15)',
                color: '#ffd700',
                border: '1px solid rgba(255, 215, 0, 0.3)',
                borderRadius: '6px',
                padding: '4px 16px',
                fontSize: '14px',
                fontWeight: 'bold',
                letterSpacing: '2px',
                textTransform: 'uppercase',
                boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
              }}
            >
              {roundLabel}
            </div>
          )}
        </div>
      )}

      {/* ── Sticker / VS Badge Overlay ── */}
      {stickerSrc && (
        <div
          style={{
            position: 'absolute',
            right: '8%',
            top: '40%',
            width: '12%',
            height: '12%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 4,
            transform: `scale(${scale})`,
            opacity,
          }}
        >
          <Img
            src={stickerSrc}
            style={{
              maxHeight: '100%',
              maxWidth: '100%',
              objectFit: 'contain',
              filter: 'drop-shadow(0 6px 12px rgba(0,0,0,0.4))',
            }}
          />
        </div>
      )}
    </AbsoluteFill>
  );
}
export default ComparisonScene;
