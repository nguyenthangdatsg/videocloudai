# Text on Screen Animation Effects — Design Spec

## Overview

Add animation effects to `[TEXT ON SCREEN]` overlays in Script Studio. Replace the current static FFmpeg `drawtext` approach with a Remotion-based `TextOverlay` composition that supports 5 animation types.

## Animation Effects

| Effect | Description | Category |
|--------|-------------|----------|
| `typewriter` | Characters appear one by one (DEFAULT) | Entrance |
| `fade-in` | Text fades from transparent to fully visible | Entrance |
| `fade-out` | Text fades out before clip ends | Exit |
| `slide-in` | Text slides up into position from below | Entrance |
| `pop` | Text starts small and scales up with slight bounce | Entrance |
| `none` | Static text, no animation (legacy behavior) | — |

- Entrance effects (`typewriter`, `fade-in`, `slide-in`, `pop`) are mutually exclusive — pick one.
- `fade-out` can combine with any entrance effect.
- Default when unspecified: `typewriter`.

## Architecture

### Rendering Pipeline

```
Block overlays + style + animation
  → Remotion TextOverlay composition (transparent background)
  → Render to MP4 with alpha (ProRes 4444 or PNG sequence)
  → FFmpeg overlay filter composites onto shot clip
```

This follows the existing CTA overlay pattern in `video-producer.service.ts`.

### Remotion Composition: `TextOverlay`

**New file:** `apps/server/src/remotion/compositions/TextOverlay.tsx`

**Props:**
```typescript
interface TextOverlayProps {
  lines: string[];              // overlay text lines
  color: string;                // text color hex (default '#FFFFFF')
  fontSize: number;             // computed pixel size
  position: 'top' | 'center' | 'bottom';
  bgEnabled: boolean;
  bgColor: string;
  bgOpacity: number;
  animation: TextOverlayAnimation;
  width: number;
  height: number;
}

type TextOverlayAnimation = 'typewriter' | 'fade-in' | 'fade-out' | 'slide-in' | 'pop' | 'none';
```

**Registration:** Add `TextOverlay` composition to `Root.tsx` with flexible resolution.

**Animation Implementation:**
- `typewriter`: Use `useCurrentFrame()` to reveal characters progressively over ~1.5s
- `fade-in`: Interpolate opacity 0→1 over ~0.8s using `interpolate()`
- `fade-out`: Interpolate opacity 1→0 over last ~0.8s of clip
- `slide-in`: Interpolate translateY from +100px to 0 over ~0.8s with easeOut
- `pop`: Interpolate scale from 0.3→1.05→1.0 over ~0.6s (spring-like)
- `none`: Static render, full opacity throughout

## Data Model Changes

### `overlay_style_json` in `script_blocks` table

Add `animation` field:
```typescript
interface OverlayStyle {
  color?: string;
  bgEnabled?: boolean;
  bgColor?: string;
  bgOpacity?: number;
  fontSize?: 'sm' | 'md' | 'lg' | 'xl';
  position?: 'center' | 'top' | 'bottom';
  animation?: TextOverlayAnimation;  // NEW — per-block override
}
```

### `produce_options_json` in `script_docs` table

Add `overlayAnimation` field:
```typescript
interface ProduceOptions {
  // ... existing fields ...
  overlayAnimation?: TextOverlayAnimation;  // NEW — global default
}
```

No schema migration needed — both are JSON columns with optional fields.

### Resolution Order

```
block.overlayStyle.animation  ??  doc.produceOptions.overlayAnimation  ??  'typewriter'
```

## Backend Changes

### `video-producer.service.ts`

1. **New function: `renderTextOverlay()`**
   - Resolve animation type (per-block → global → default)
   - Compute font size from OverlayStyle `fontSize` preset + video dimensions
   - Call Remotion `renderMedia()` for `TextOverlay` composition
   - Output: transparent-background video clip (same duration as shot)

2. **Modify clip assembly path** (where `buildOverlayDrawtext()` is currently called)
   - Instead of appending drawtext filters, render TextOverlay → composite via FFmpeg `overlay` filter
   - Cache rendered overlay by content hash (text + style + animation + duration)

3. **Keep `buildOverlayDrawtext()`** as fallback for non-script-studio paths (storyboard, etc.) — no regression.

### `remotion-renderer.service.ts`

Add `renderTextOverlay()` method that:
- Takes overlay props + duration + fps
- Renders `TextOverlay` composition
- Returns path to rendered overlay clip

### `Root.tsx`

Register new `TextOverlay` composition.

## Frontend Changes

### `ScriptDoc.tsx` — Per-block overlay panel

Add animation dropdown to the existing overlay style controls:
- Label: "Animation"
- Options: Typewriter, Fade In, Fade Out, Slide In, Pop, None
- Default: empty (inherits global)

### `ProduceModal.tsx` — Global default

Add "Default Overlay Animation" dropdown to produce options:
- Same options as per-block
- Default: Typewriter

### i18n Keys

Add to both `en.json` and `vi.json`:
- `scriptStudio.overlayAnimation` — "Animation"
- `scriptStudio.overlayAnimationDefault` — "Default Overlay Animation"
- `scriptStudio.animation.typewriter` — "Typewriter"
- `scriptStudio.animation.fadeIn` — "Fade In"
- `scriptStudio.animation.fadeOut` — "Fade Out"
- `scriptStudio.animation.slideIn` — "Slide In"
- `scriptStudio.animation.pop` — "Pop"
- `scriptStudio.animation.none` — "None"
- `scriptStudio.animation.inherit` — "Use Default"

## Files to Create/Modify

| File | Action |
|------|--------|
| `apps/server/src/remotion/compositions/TextOverlay.tsx` | CREATE |
| `apps/server/src/remotion/Root.tsx` | MODIFY — register TextOverlay |
| `apps/server/src/remotion/types.ts` | MODIFY — add TextOverlayProps type |
| `apps/server/src/services/remotion-renderer.service.ts` | MODIFY — add renderTextOverlay() |
| `apps/server/src/services/video-producer.service.ts` | MODIFY — use Remotion overlay instead of drawtext |
| `apps/web/src/pages/script-studio/ScriptDoc.tsx` | MODIFY — add animation dropdown |
| `apps/web/src/pages/script-studio/ProduceModal.tsx` | MODIFY — add global animation setting |
| `apps/web/src/i18n/locales/en.json` | MODIFY — add i18n keys |
| `apps/web/src/i18n/locales/vi.json` | MODIFY — add i18n keys |

## Edge Cases

- **Empty overlay text**: Skip rendering (same as current behavior)
- **Very long text**: Font auto-sizing already handled by fontSize presets; Remotion wraps text
- **Multiple overlays per block**: Render all lines in single TextOverlay composition (stacked)
- **Combined animations**: `fade-out` + entrance effect both applied; entrance plays at start, fade-out at end
- **Short clips (<2s)**: Animation durations scale down proportionally to fit
- **Cache invalidation**: Animation type included in content hash for rendered clip cache
