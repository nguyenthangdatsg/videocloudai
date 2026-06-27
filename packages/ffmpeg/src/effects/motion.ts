import type { MotionEffectType } from '@videocloudai/shared';

export interface MotionFilter {
  videoFilter: string;
  description: string;
}

// Target resolution for shorts: 1080x1920
const W = 1080;
const H = 1920;

// For zoompan we work at 2x source then crop
const ZOOM_W = W * 2;
const ZOOM_H = H * 2;

export function buildMotionFilter(effect: MotionEffectType, duration: number, fps = 24): MotionFilter {
  const totalFrames = Math.round(duration * fps);

  switch (effect) {
    case 'ken-burns-in':
      return {
        videoFilter: [
          `scale=${ZOOM_W}:${ZOOM_H}`,
          `zoompan=z='min(zoom+0.0015,1.5)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${W}x${H}:fps=${fps}`,
        ].join(','),
        description: 'Ken Burns slow zoom in',
      };

    case 'ken-burns-out':
      return {
        videoFilter: [
          `scale=${ZOOM_W}:${ZOOM_H}`,
          `zoompan=z='if(lte(zoom,1.0),1.5,max(1.0,zoom-0.0015))':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${W}x${H}:fps=${fps}`,
        ].join(','),
        description: 'Ken Burns slow zoom out',
      };

    case 'pan-left':
      return {
        videoFilter: [
          `scale=${ZOOM_W}:${ZOOM_H}`,
          `zoompan=z='1.2':x='if(lte(on,1),0,(${ZOOM_W}/1.2-iw/zoom)*(on/${totalFrames}))':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${W}x${H}:fps=${fps}`,
        ].join(','),
        description: 'Slow pan left',
      };

    case 'pan-right':
      return {
        videoFilter: [
          `scale=${ZOOM_W}:${ZOOM_H}`,
          `zoompan=z='1.2':x='if(lte(on,1),${ZOOM_W}/1.2-iw/zoom,(${ZOOM_W}/1.2-iw/zoom)*(1-on/${totalFrames}))':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${W}x${H}:fps=${fps}`,
        ].join(','),
        description: 'Slow pan right',
      };

    case 'slow-zoom':
      return {
        videoFilter: [
          `scale=${ZOOM_W}:${ZOOM_H}`,
          `zoompan=z='min(zoom+0.0008,1.3)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${W}x${H}:fps=${fps}`,
        ].join(','),
        description: 'Very slow subtle zoom',
      };

    case 'drift':
      return {
        videoFilter: [
          `scale=${ZOOM_W}:${ZOOM_H}`,
          `zoompan=z='1.1':x='iw/2-(iw/zoom/2)+sin(on/${totalFrames}*PI)*20':y='ih/2-(ih/zoom/2)+cos(on/${totalFrames}*PI)*10':d=${totalFrames}:s=${W}x${H}:fps=${fps}`,
        ].join(','),
        description: 'Gentle cinematic drift',
      };

    case 'handheld':
      return {
        videoFilter: [
          `scale=${ZOOM_W}:${ZOOM_H}`,
          `zoompan=z='1.05':x='iw/2-(iw/zoom/2)+sin(on*0.3)*4+sin(on*0.7)*2':y='ih/2-(ih/zoom/2)+cos(on*0.4)*3+cos(on*0.9)*2':d=${totalFrames}:s=${W}x${H}:fps=${fps}`,
        ].join(','),
        description: 'Handheld camera simulation',
      };

    case 'static':
    default:
      return {
        videoFilter: `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`,
        description: 'Static shot',
      };
  }
}

export function buildTransitionFilter(type: string, duration = 0.5, fps = 24): string {
  const frames = Math.round(duration * fps);
  switch (type) {
    case 'fade':
      return `fade=t=in:st=0:d=${duration}`;
    case 'dissolve':
      return `fade=t=in:st=0:d=${duration}:alpha=1`;
    default:
      return '';
  }
}

export function buildSubtitleFilter(
  text: string,
  startSec: number,
  endSec: number,
  style: 'tiktok' | 'minimal' | 'karaoke' = 'tiktok'
): string {
  const escaped = text.replace(/'/g, "\\'").replace(/:/g, '\\:');

  if (style === 'tiktok') {
    return (
      `drawtext=text='${escaped}':` +
      `fontsize=52:fontcolor=white:` +
      `bordercolor=black:borderw=3:` +
      `x=(w-text_w)/2:y=h*0.75:` +
      `fontfile=/Windows/Fonts/Arial.ttf:` +
      `enable='between(t,${startSec},${endSec})'`
    );
  }

  return (
    `drawtext=text='${escaped}':` +
    `fontsize=42:fontcolor=white:` +
    `x=(w-text_w)/2:y=h*0.8:` +
    `enable='between(t,${startSec},${endSec})'`
  );
}
