import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate, Easing, Img, OffthreadVideo } from 'remotion';

export interface SplitScreenConfig {
  durationInFrames: number;
  leftSrc: string;
  leftType: 'image' | 'video';
  rightSrc: string;
  rightType: 'image' | 'video';
  middleText?: string;
  middleStyle?: 'vs' | 'line' | 'glow' | 'badge' | 'fire' | 'neon' | 'slash' | 'clean' | 'none';
  accentColor?: string;
  bgColor?: string;
  leftLabel?: string;
  rightLabel?: string;
  leftLabelPosition?: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
  rightLabelPosition?: 'top-left' | 'top-center' | 'top-right' | 'bottom-left' | 'bottom-center' | 'bottom-right';
  labelStyle?: 'badge' | 'outline' | 'shadow' | 'banner';
  labelFontSize?: number;
  gap?: number;
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
    leftLabelPosition = 'top-center',
    rightLabelPosition = 'top-center',
    labelStyle = 'badge',
    labelFontSize,
    gap = 6,
  } = props;

  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const isPortrait = height > width;

  // Animations
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

  // Panel dimensions
  const panelW = isPortrait ? width : (width - gap) / 2;
  const panelH = isPortrait ? (height - gap) / 2 : height;

  const scale = Math.min(width, height) / 1080;
  const baseFontSize = labelFontSize ?? Math.round(28 * scale);

  const renderMedia = (src: string, type: 'image' | 'video', side: 'left' | 'right') => {
    const style: React.CSSProperties = {
      width: '100%',
      height: '100%',
      objectFit: 'cover',
    };
    if (type === 'video' && src) {
      return <OffthreadVideo src={src} style={style} />;
    }
    if (src) {
      return <Img src={src} style={style} />;
    }
    return (
      <div style={{
        width: '100%', height: '100%',
        background: side === 'left' ? '#1a1a2e' : '#16213e',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 40 }}>
          {isPortrait ? (side === 'left' ? 'T' : 'B') : (side === 'left' ? 'L' : 'R')}
        </span>
      </div>
    );
  };

  const renderLabel = (label: string | undefined, position: string, maxW: number) => {
    if (!label) return null;

    const isTop = position.startsWith('top');
    const hAlign = position.split('-')[1];

    const posStyle: React.CSSProperties = {
      position: 'absolute',
      ...(isTop ? { top: Math.round(panelH * 0.04) } : { bottom: Math.round(panelH * 0.04) }),
      ...(hAlign === 'center' ? { left: '50%', transform: 'translateX(-50%)' } :
         hAlign === 'right' ? { right: Math.round(20 * scale) } :
         { left: Math.round(20 * scale) }),
      maxWidth: maxW * 0.8,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap' as const,
      opacity: fadeIn,
      fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
      fontSize: baseFontSize,
      fontWeight: 700,
      zIndex: 5,
    };

    const textStyle: React.CSSProperties = (() => {
      switch (labelStyle) {
        case 'outline':
          return {
            color: '#fff',
            WebkitTextStroke: `${Math.max(1, Math.round(scale * 2))}px rgba(0,0,0,0.9)`,
            paintOrder: 'stroke fill' as any,
          };
        case 'shadow':
          return {
            color: '#fff',
            textShadow: '2px 2px 6px rgba(0,0,0,0.9)',
          };
        case 'banner':
          return {
            color: '#fff',
            background: 'rgba(0,0,0,0.6)',
            padding: `${Math.round(8 * scale)}px ${Math.round(16 * scale)}px`,
            borderRadius: Math.round(4 * scale),
          };
        case 'badge':
        default:
          return {
            color: '#fff',
            background: 'rgba(0,0,0,0.7)',
            backdropFilter: 'blur(8px)',
            padding: `${Math.round(8 * scale)}px ${Math.round(16 * scale)}px`,
            borderRadius: Math.round(8 * scale),
          };
      }
    })();

    return (
      <div style={{ ...posStyle, ...textStyle }}>
        {label}
      </div>
    );
  };

  const renderMiddle = () => {
    if (middleStyle === 'none' && !middleText) return null;

    const text = middleText || '';
    const mFontSize = Math.round((text.length <= 3 ? 48 : text.length <= 8 ? 36 : 28) * scale);

    const centerStyle: React.CSSProperties = {
      position: 'absolute',
      left: '50%', top: '50%',
      transform: `translate(-50%, -50%) scale(${middlePop})`,
      zIndex: 10,
    };

    // Divider (line-based styles)
    const dividerStyle: React.CSSProperties = isPortrait
      ? {
          position: 'absolute',
          left: 0, right: 0,
          top: '50%',
          transform: 'translateY(-50%)',
          height: 4,
          zIndex: 10,
        }
      : {
          position: 'absolute',
          top: 0, bottom: 0,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 4,
          zIndex: 10,
        };

    switch (middleStyle) {
      case 'vs':
        return (
          <>
            {text && (
              <div style={centerStyle}>
                <div style={{
                  background: accentColor,
                  color: '#fff',
                  fontSize: mFontSize,
                  fontWeight: 900,
                  padding: `${Math.round(12 * scale)}px ${Math.round(24 * scale)}px`,
                  borderRadius: Math.round(12 * scale),
                  letterSpacing: '0.05em',
                  textShadow: `0 0 30px ${accentColor}88`,
                  boxShadow: `0 0 40px ${accentColor}44, 0 4px 20px rgba(0,0,0,0.5)`,
                  fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
                }}>
                  {text}
                </div>
              </div>
            )}
          </>
        );

      case 'glow':
        return (
          <>
            <div style={{
              ...dividerStyle,
              background: isPortrait
                ? `linear-gradient(90deg, transparent 0%, ${accentColor} 20%, ${accentColor} 80%, transparent 100%)`
                : `linear-gradient(180deg, transparent 0%, ${accentColor} 20%, ${accentColor} 80%, transparent 100%)`,
              boxShadow: `0 0 30px ${accentColor}88, 0 0 60px ${accentColor}44`,
              opacity: middlePop,
            }} />
            {text && (
              <div style={centerStyle}>
                <div style={{
                  color: accentColor,
                  fontSize: mFontSize,
                  fontWeight: 900,
                  textShadow: `0 0 40px ${accentColor}, 0 0 80px ${accentColor}66`,
                  fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
                  letterSpacing: '0.05em',
                }}>
                  {text}
                </div>
              </div>
            )}
          </>
        );

      case 'badge':
        return (
          <>
            {text && (
              <div style={centerStyle}>
                <div style={{
                  background: 'rgba(0,0,0,0.8)',
                  border: `3px solid ${accentColor}`,
                  color: '#fff',
                  fontSize: mFontSize,
                  fontWeight: 800,
                  padding: `${Math.round(10 * scale)}px ${Math.round(22 * scale)}px`,
                  borderRadius: 999,
                  fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
                  boxShadow: `0 0 30px ${accentColor}44`,
                }}>
                  {text}
                </div>
              </div>
            )}
          </>
        );

      case 'fire':
        return (
          <>
            <div style={{
              ...dividerStyle,
              ...(isPortrait ? { height: 14 } : { width: 14 }),
              background: '#FF4500',
              boxShadow: '0 0 20px #FF4500cc, 0 0 40px #FF8C0066',
              opacity: middlePop,
            }} />
            {text && (
              <div style={centerStyle}>
                <div style={{
                  background: '#FF4500',
                  color: '#FFD700',
                  fontSize: mFontSize + Math.round(4 * scale),
                  fontWeight: 900,
                  padding: `${Math.round(12 * scale)}px ${Math.round(24 * scale)}px`,
                  borderRadius: Math.round(12 * scale),
                  border: '3px solid #FF0000',
                  textShadow: '0 0 8px #FF4500, 0 0 16px #FF8C00',
                  fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
                  boxShadow: '0 0 30px #FF450066, 0 0 60px #FF8C0033',
                }}>
                  {text}
                </div>
              </div>
            )}
          </>
        );

      case 'neon':
        return (
          <>
            <div style={{
              ...dividerStyle,
              ...(isPortrait ? { height: 2 } : { width: 2 }),
              background: accentColor,
              boxShadow: `0 0 8px ${accentColor}, 0 0 16px ${accentColor}80, 0 0 32px ${accentColor}40`,
              opacity: middlePop,
            }} />
            {text && (
              <div style={centerStyle}>
                <div style={{
                  background: 'rgba(0,0,0,0.6)',
                  color: accentColor,
                  fontSize: mFontSize,
                  fontWeight: 900,
                  padding: `${Math.round(10 * scale)}px ${Math.round(20 * scale)}px`,
                  borderRadius: Math.round(8 * scale),
                  border: '3px solid white',
                  textShadow: `0 0 6px ${accentColor}, 0 0 12px ${accentColor}`,
                  fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
                }}>
                  {text}
                </div>
              </div>
            )}
          </>
        );

      case 'slash':
        return (
          <>
            <div style={{
              ...dividerStyle,
              ...(isPortrait ? { height: 28 } : { width: 28 }),
              background: '#000',
              overflow: 'hidden',
              opacity: middlePop,
            }}>
              <div style={{
                position: 'absolute',
                inset: 0,
                background: `linear-gradient(${isPortrait ? 245 : 155}deg, transparent 40%, ${accentColor} 40%, ${accentColor} 60%, transparent 60%)`,
              }} />
            </div>
            {text && (
              <div style={centerStyle}>
                <div style={{
                  background: accentColor,
                  color: '#fff',
                  fontSize: mFontSize - Math.round(4 * scale),
                  fontWeight: 800,
                  padding: `${Math.round(8 * scale)}px ${Math.round(18 * scale)}px`,
                  borderRadius: Math.round(8 * scale),
                  border: '2px solid #000',
                  fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
                }}>
                  {text}
                </div>
              </div>
            )}
          </>
        );

      case 'clean':
        return (
          <>
            <div style={{
              ...dividerStyle,
              ...(isPortrait ? { height: 3 } : { width: 3 }),
              background: 'rgba(255,255,255,0.3)',
              opacity: middlePop,
            }} />
            {text && (
              <div style={centerStyle}>
                <div style={{
                  background: '#222',
                  color: '#fff',
                  fontSize: Math.max(Math.round(22 * scale), mFontSize - Math.round(8 * scale)),
                  fontWeight: 700,
                  padding: `${Math.round(6 * scale)}px ${Math.round(14 * scale)}px`,
                  borderRadius: Math.round(6 * scale),
                  border: '1px solid #444',
                  fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
                }}>
                  {text}
                </div>
              </div>
            )}
          </>
        );

      case 'line':
        return (
          <div style={{
            ...dividerStyle,
            background: isPortrait
              ? `linear-gradient(90deg, transparent 0%, ${accentColor} 20%, ${accentColor} 80%, transparent 100%)`
              : `linear-gradient(180deg, transparent 0%, ${accentColor} 20%, ${accentColor} 80%, transparent 100%)`,
            boxShadow: `0 0 20px ${accentColor}66`,
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
                fontSize: Math.round(height * 0.025),
                fontWeight: 800,
                padding: `${Math.round(6 * scale)}px ${Math.round(16 * scale)}px`,
                borderRadius: 8,
                whiteSpace: 'nowrap',
                fontFamily: '"Inter", "Helvetica Neue", Arial, sans-serif',
              }}>
                {text}
              </div>
            )}
          </div>
        );

      case 'none':
      default:
        return gap > 0 ? null : (
          <div style={{
            ...dividerStyle,
            ...(isPortrait ? { height: 2 } : { width: 2 }),
            background: accentColor,
            opacity: middlePop,
          }} />
        );
    }
  };

  // Slide direction based on orientation
  const slideOffset = Math.round(60 * scale);
  const leftTransform = isPortrait
    ? `translateY(${(1 - slideIn) * -slideOffset}px)`
    : `translateX(${(1 - slideIn) * -slideOffset}px)`;
  const rightTransform = isPortrait
    ? `translateY(${(1 - slideIn) * slideOffset}px)`
    : `translateX(${(1 - slideIn) * slideOffset}px)`;

  // Border radius per panel
  const leftRadius = gap > 0
    ? (isPortrait ? '0 0 8px 8px' : '0 8px 8px 0')
    : 0;
  const rightRadius = gap > 0
    ? (isPortrait ? '8px 8px 0 0' : '8px 0 0 8px')
    : 0;

  return (
    <div style={{
      width, height, background: bgColor,
      display: 'flex',
      flexDirection: isPortrait ? 'column' : 'row',
      position: 'relative',
      overflow: 'hidden',
      opacity: fadeIn,
    }}>
      {/* Left / Top panel */}
      <div style={{
        width: panelW,
        height: panelH,
        overflow: 'hidden',
        position: 'relative',
        transform: leftTransform,
        borderRadius: leftRadius,
        flexShrink: 0,
      }}>
        {renderMedia(leftSrc, leftType, 'left')}
        {renderLabel(leftLabel, leftLabelPosition, panelW)}
      </div>

      {/* Gap */}
      {gap > 0 && (
        <div style={{
          ...(isPortrait ? { height: gap } : { width: gap }),
          flexShrink: 0,
        }} />
      )}

      {/* Right / Bottom panel */}
      <div style={{
        width: panelW,
        height: panelH,
        overflow: 'hidden',
        position: 'relative',
        transform: rightTransform,
        borderRadius: rightRadius,
        flexShrink: 0,
      }}>
        {renderMedia(rightSrc, rightType, 'right')}
        {renderLabel(rightLabel, isPortrait ? rightLabelPosition : leftLabelPosition, panelW)}
      </div>

      {/* Middle decorator */}
      {renderMiddle()}
    </div>
  );
}
