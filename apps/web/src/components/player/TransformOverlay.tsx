import { clsx } from 'clsx';
import type { FrameTransform, LogoPosition } from '../../features/editor-ai/store';

interface Props {
  transform: FrameTransform;
  className?: string;
}

// Compose CSS transforms applied directly to the <video> tag.
export function buildFrameTransformCss(t: FrameTransform): string {
  const parts: string[] = [];
  if (t.flipH) parts.push('scaleX(-1)');
  if (t.flipV) parts.push('scaleY(-1)');
  if (t.rotation !== 0) parts.push(`rotate(${t.rotation}deg)`);
  return parts.join(' ');
}

// Crop is implemented as an object-position + scale trick:
//   - We scale the video up by 1/cropWidth (so the crop area fills the container)
//   - We translate the video so the crop x/y becomes the new origin
// Together with overflow-hidden on the parent, this produces a true crop in the browser.
export function buildCropTransformCss(t: FrameTransform): string | null {
  if (!t.crop) return null;
  const { x, y, width, height } = t.crop;
  // Guard against degenerate crops
  if (width <= 0 || height <= 0) return null;

  const scaleX = 1 / width;
  const scaleY = 1 / height;
  // Translate so (cx, cy) inside the source maps to the container origin.
  // After scaling, a translation of -x*scaleX*100% in container units moves the crop into view.
  const tx = -x * scaleX * 100;
  const ty = -y * scaleY * 100;
  return `translate(${tx}%, ${ty}%) scale(${scaleX}, ${scaleY})`;
}

const POSITION_CLASSES: Record<LogoPosition, string> = {
  'top-left':     'top-3 left-3',
  'top-right':    'top-3 right-3',
  'bottom-left':  'bottom-3 left-3',
  'bottom-right': 'bottom-3 right-3',
  'center':       'top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
};

export function TransformOverlay({ transform, className }: Props) {
  if (!transform.logoUrl) return null;

  return (
    <div className={clsx('absolute inset-0 pointer-events-none', className)}>
      <img
        src={transform.logoUrl}
        alt=""
        className={clsx('absolute object-contain', POSITION_CLASSES[transform.logoPosition])}
        style={{
          width: `${transform.logoSize}%`,
          opacity: transform.logoOpacity,
          maxHeight: '50%',
        }}
        draggable={false}
      />
    </div>
  );
}
