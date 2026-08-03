import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, Easing, Img, OffthreadVideo, staticFile } from 'remotion';

export interface SplitScreenConfig {
  durationInFrames: number;
  leftSrc: string;
  leftType: 'image' | 'video';
  rightSrc: string;
  rightType: 'image' | 'video';
  middleText?: string;
  middleStyle?: 'vs' | 'line' | 'glow' | 'badge' | 'none';
  accentColor?: string;
  bgColor?: string;
  leftLabel?: string;
  rightLabel?: string;
  gap?: number; // px gap between panels (default 6)
}

export function SplitScreen(props: SplitScreenConfig) {
  const {
    leftSrc,
    leftType,
    rightSrc,
    rightType,
    middleText = '',
    middleStyle = 'vs',
    accentColor = '#7c6af5',
    bgColor = '#0d0e12',
    leftLabel,
    rightLabel,
    gap = 6,
    durationInFrames,
  } = props;

  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  // Animation
  const slideIn = interpolate(frame, [0, Math.min(fps * 0.4, 10)], [0, 1], {
    easing: Easing.out(Easing.cubic),
    extrapolateRight: 'clamp',
  });
  const fadeIn = interpolate(frame, [0, Math.min(fps * 0.3, 8)], [0, 1], {
    extrapolateRight: 'clamp',
  });
  const middlePop = interpolate(frame, [fps * 0.15, fps * 0.5], [0, 1], {
    easing: Easing.out(Easing.back(1.5)),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const panelW = (width - gap) / 2;
  const panelH = height;

  const renderMedia = (src: string, type: 'image' | 'video', side: 'left' | 'right') => {
    const style: React.CSSProperties = {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
    };
    if (type === 'video' && src) {
      return <OffthreadVideo src={staticFile(src)} style={style} />;
    }
    if (src) {
      return <Img src={staticFile(src)} style={style} />;
    }
    // Placeholder
    return (
      <div style={{
        width: '100%', height: '100%',
        background: side === 'left' ? '#1a1a2e' : '#16213e',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 40 }}>{side === 'left' ? 'L' : 'R'}</span>
      </div>
    );
  };

  const renderMiddle = () => {
    if (middleStyle === 'none' && !middleText) return null;

    const text = middleText || (middleStyle === 'vs' ? 'VS' : '');

    if (middleStyle === 'vs') {
      return (
        <div style={{
          position: 'absolute',
          left: '50%', top: '50%',
          transform: `translate(-50%, -50%) scale(${middlePop})`,
          zIndex: 10,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', gap: 8,
        }}>
          <div style={{
            background: accentColor,
            color: '#fff',
            fontSize: Math.round(height * 0.05),
            fontWeight: 900,
            padding: `${Math.round(height * 0.015)}px ${Math.round(height * 0.03)}px`,
            borderRadius: Math.round(height * 0.015),
            letterSpacing: '0.05em',
            textShadow: `0 0 30px ${accentColor}88`,
            boxShadow: `0 0 40px ${accentColor}44, 0 4px 20px rgba(0,0,0,0.5)`,
            fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
          }}>
            {text}
          </div>
        </div>
      );
    }

    if (middleStyle === 'glow') {
      return (
        <div style={{
          position: 'absolute',
          left: '50%', top: '50%',
          transform: `translate(-50%, -50%) scale(${middlePop})`,
          zIndex: 10,
        }}>
          <div style={{
            color: accentColor,
            fontSize: Math.round(height * 0.06),
            fontWeight: 900,
            textShadow: `0 0 40px ${accentColor}, 0 0 80px ${accentColor}66`,
            fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
            letterSpacing: '0.05em',
          }}>
            {text}
          </div>
        </div>
      );
    }

    if (middleStyle === 'badge') {
      return (
        <div style={{
          position: 'absolute',
          left: '50%', top: '50%',
          transform: `translate(-50%, -50%) scale(${middlePop})`,
          zIndex: 10,
        }}>
          <div style={{
            background: 'rgba(0,0,0,0.8)',
            border: `3px solid ${accentColor}`,
            color: '#fff',
            fontSize: Math.round(height * 0.04),
            fontWeight: 800,
            padding: `${Math.round(height * 0.012)}px ${Math.round(height * 0.025)}px`,
            borderRadius: 999,
            fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
            boxShadow: `0 0 30px ${accentColor}44`,
          }}>
            {text}
          </div>
        </div>
      );
    }

    // 'line' style — vertical glowing line
    return (
      <div style={{
        position: 'absolute',
        left: '50%', top: 0,
        transform: 'translateX(-50%)',
        width: 4,
        height: '100%',
        background: `linear-gradient(180deg, transparent 0%, ${accentColor} 20%, ${accentColor} 80%, transparent 100%)`,
        boxShadow: `0 0 20px ${accentColor}66`,
        zIndex: 10,
        opacity: middlePop,
      }}>
        {text && (
          <div style={{
            position: 'absolute',
            left: '50%', top: '50%',
            transform: `translate(-50%, -50%) scale(${middlePop})`,
            background: bgColor,
            border: `2px solid ${accentColor}`,
            color: '#fff',
            fontSize: Math.round(height * 0.03),
            fontWeight: 800,
            padding: `${Math.round(height * 0.008)}px ${Math.round(height * 0.02)}px`,
            borderRadius: 8,
            whiteSpace: 'nowrap',
            fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
          }}>
            {text}
          </div>
        )}
      </div>
    );
  };

  const renderLabel = (label: string | undefined, side: 'left' | 'right') => {
    if (!label) return null;
    return (
      <div style={{
        position: 'absolute',
        bottom: Math.round(height * 0.03),
        left: side === 'left' ? Math.round(height * 0.02) : undefined,
        right: side === 'right' ? Math.round(height * 0.02) : undefined,
        background: 'rgba(0,0,0,0.7)',
        backdropFilter: 'blur(8px)',
        color: '#fff',
        fontSize: Math.round(height * 0.028),
        fontWeight: 700,
        padding: `${Math.round(height * 0.008)}px ${Math.round(height * 0.018)}px`,
        borderRadius: 8,
        fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
        maxWidth: panelW * 0.8,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        opacity: fadeIn,
      }}>
        {label}
      </div>
    );
  };

  return (
    <div style={{
      width, height, background: bgColor,
      display: 'flex',
      position: 'relative',
      overflow: 'hidden',
      opacity: fadeIn,
    }}>
      {/* Left panel */}
      <div style={{
        width: panelW,
        height: panelH,
        overflow: 'hidden',
        position: 'relative',
        transform: `translateX(${(1 - slideIn) * -60}px)`,
        borderRadius: gap > 0 ? '0 8px 8px 0' : 0,
      }}>
        {renderMedia(leftSrc, leftType, 'left')}
        {renderLabel(leftLabel, 'left')}
      </div>

      {/* Gap */}
      {gap > 0 && <div style={{ width: gap, flexShrink: 0 }} />}

      {/* Right panel */}
      <div style={{
        width: panelW,
        height: panelH,
        overflow: 'hidden',
        position: 'relative',
        transform: `translateX(${(1 - slideIn) * 60}px)`,
        borderRadius: gap > 0 ? '8px 0 0 8px' : 0,
      }}>
        {renderMedia(rightSrc, rightType, 'right')}
        {renderLabel(rightLabel, 'right')}
      </div>

      {/* Middle decorator */}
      {renderMiddle()}
    </div>
  );
}
