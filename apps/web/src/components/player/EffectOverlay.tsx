import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import type { CinematicEffect, TransitionType, SubtitleStyle } from '../../features/editor-ai/types';

interface Props {
  effects: CinematicEffect[];
  transition?: TransitionType;
  subtitleStyle?: SubtitleStyle;
  className?: string;
}

// CSS filters applied directly to the <video> element by EditorVideoPlayer.
// Exposed as a pure function so the player can compose it onto the video tag.
export function buildVideoFilter(effects: CinematicEffect[]): string {
  const parts: string[] = [];
  if (effects.includes('color-grade')) parts.push('saturate(1.25) contrast(1.10)');
  if (effects.includes('glow')) parts.push('brightness(1.08) saturate(1.18)');
  if (effects.includes('anime-flash')) parts.push('contrast(1.05)');
  return parts.join(' ');
}

export function buildVideoTransform(effects: CinematicEffect[]): string {
  const parts: string[] = [];
  if (effects.includes('zoom-punch')) parts.push('scale(1.04)');
  return parts.join(' ');
}

export function getPlaybackRateForEffects(effects: CinematicEffect[]): number | null {
  if (effects.includes('speed-ramp')) return 1.5;
  return null;
}

// SVG-based film grain — small inline data URI so no extra request needed.
// Subtle animated noise on overlay blend mode.
const GRAIN_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">' +
      '<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" stitchTiles="stitch"/></filter>' +
      '<rect width="100%" height="100%" filter="url(#n)" opacity="0.55"/>' +
      '</svg>'
  );

export function EffectOverlay({ effects, subtitleStyle, className }: Props) {
  const { t } = useTranslation();
  if (effects.length === 0 && !subtitleStyle) return null;

  const has = (fx: CinematicEffect) => effects.includes(fx);
  const sampleCaption = t('editor.player.sampleCaption');

  return (
    <div className={clsx('absolute inset-0 pointer-events-none overflow-hidden', className)}>
      {/* Local keyframes injected via inline style; scoped via the wrapper class. */}
      <style>{`
        @keyframes vc-shake {
          0% { transform: translate(0, 0); }
          15% { transform: translate(-2px, 1px); }
          35% { transform: translate(2px, -1px); }
          55% { transform: translate(-1px, -2px); }
          75% { transform: translate(2px, 1px); }
          100% { transform: translate(0, 0); }
        }
        @keyframes vc-grain {
          0%, 100% { transform: translate(0, 0); }
          25% { transform: translate(-4%, 3%); }
          50% { transform: translate(3%, -2%); }
          75% { transform: translate(-2%, -3%); }
        }
        @keyframes vc-flash {
          0%, 70%, 100% { opacity: 0; }
          50% { opacity: 0.28; }
        }
        @keyframes vc-leak {
          0%, 100% { opacity: 0.6; transform: translate(0, 0); }
          50% { opacity: 0.85; transform: translate(2%, -1%); }
        }
      `}</style>

      {/* Vignette — soft dark edges */}
      {has('vignette') && (
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(ellipse at center, transparent 45%, rgba(0,0,0,0.55) 100%)',
          }}
        />
      )}

      {/* Light leak — warm gradient with subtle drift */}
      {has('light-leak') && (
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(125deg, rgba(255,140,60,0.22) 0%, transparent 40%, transparent 60%, rgba(255,200,120,0.18) 100%)',
            mixBlendMode: 'screen',
            animation: 'vc-leak 6s ease-in-out infinite',
          }}
        />
      )}

      {/* Film grain — animated noise */}
      {has('film-grain') && (
        <div
          className="absolute -inset-[10%]"
          style={{
            backgroundImage: `url("${GRAIN_URL}")`,
            backgroundSize: '256px 256px',
            opacity: 0.18,
            mixBlendMode: 'overlay',
            animation: 'vc-grain 1.2s steps(6, end) infinite',
          }}
        />
      )}

      {/* Anime flash — soft periodic bright pulse */}
      {has('anime-flash') && (
        <div
          className="absolute inset-0 bg-white"
          style={{ animation: 'vc-flash 2.4s ease-out infinite', mixBlendMode: 'screen' }}
        />
      )}

      {/* Manga lines — radial speed lines */}
      {has('manga-lines') && (
        <div
          className="absolute inset-0"
          style={{
            background:
              'repeating-radial-gradient(circle at center, transparent 0px, transparent 8px, rgba(255,255,255,0.06) 9px, transparent 10px)',
            mixBlendMode: 'overlay',
          }}
        />
      )}

      {/* Handheld shake indicator — applied via wrapper; not shown here */}

      {/* Subtitle style preview — a sample line so user sees the style */}
      {subtitleStyle && subtitleStyle !== 'default' && (
        <div
          className="absolute left-0 right-0 bottom-[8%] flex justify-center px-6"
          aria-hidden
        >
          <div
            className={clsx(
              'inline-block max-w-[80%] text-center',
              subtitleStyle === 'tiktok' &&
                'text-white font-extrabold text-base tracking-tight drop-shadow-[0_2px_0_rgba(0,0,0,1)] uppercase',
              subtitleStyle === 'anime' &&
                'text-yellow-300 font-bold italic text-base drop-shadow-[0_2px_0_rgba(0,0,0,0.9)]',
              subtitleStyle === 'documentary' &&
                'text-white font-medium text-sm bg-black/55 px-3 py-1 rounded',
              subtitleStyle === 'keyword-emphasis' &&
                'text-white font-semibold text-base [&_b]:text-[#9180ff]',
              subtitleStyle === 'animated' &&
                'text-white font-bold text-base animate-pulse'
            )}
          >
            {subtitleStyle === 'keyword-emphasis' ? (
              <>
                {sampleCaption.split(' ').map((w, i, arr) =>
                  i === Math.floor(arr.length / 2) ? <b key={i}>{w} </b> : <span key={i}>{w} </span>
                )}
              </>
            ) : (
              sampleCaption
            )}
          </div>
        </div>
      )}
    </div>
  );
}
