import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronLeft,
  ChevronRight,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Repeat,
  Camera,
  AlertTriangle,
  Wand2,
} from 'lucide-react';
import type { CinematicEffect, SubtitleStyle, TransitionType } from '../../features/editor-ai/types';
import {
  EffectOverlay,
  buildVideoFilter,
  buildVideoTransform,
  getPlaybackRateForEffects,
} from './EffectOverlay';
import { TransformOverlay, buildFrameTransformCss, buildCropTransformCss } from './TransformOverlay';
import { useEditorAIStore } from '../../features/editor-ai/store';

interface Props {
  src: string;
  fps?: number;
  className?: string;
  onTimeUpdate?: (currentTime: number) => void;
  onRequestOptimize?: () => void;
  optimizing?: boolean;
  // Live effect preview applied to the player
  effects?: CinematicEffect[];
  transition?: TransitionType;
  subtitleStyle?: SubtitleStyle;
}

const PLAYBACK_RATES = [0.25, 0.5, 1, 1.5, 2];

function formatTime(seconds: number, withMs = true): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  const base = `${h > 0 ? String(h).padStart(2, '0') + ':' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return withMs ? `${base}.${String(ms).padStart(2, '0')}` : base;
}

export function EditorVideoPlayer({
  src,
  fps = 30,
  className,
  onTimeUpdate,
  onRequestOptimize,
  optimizing = false,
  effects = [],
  transition,
  subtitleStyle,
}: Props) {
  const { t } = useTranslation();
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrubberRef = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [loop, setLoop] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [scrubHover, setScrubHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [buffered, setBuffered] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [noVideoTrack, setNoVideoTrack] = useState(false);
  const [autoTried, setAutoTried] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const frame = 1 / fps;

  // ─── Video event wiring ─────────────────────────────────────────────────
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onLoaded = () => {
      setDuration(v.duration || 0);
      // If the file has audio but no decodable video stream, browsers report 0x0 dimensions.
      // That's the classic "black screen with audio" symptom from AV1/HEVC in browsers.
      setNoVideoTrack(v.videoWidth === 0 && v.videoHeight === 0);
    };
    const onTime = () => {
      setCurrentTime(v.currentTime);
      onTimeUpdate?.(v.currentTime);
    };
    const onProgress = () => {
      if (v.buffered.length > 0) setBuffered(v.buffered.end(v.buffered.length - 1));
    };
    const onEnded = () => {
      if (loop) {
        v.currentTime = 0;
        v.play().catch(() => undefined);
      }
    };
    const onError = () => {
      const code = v.error?.code;
      const map: Record<number, string> = {
        1: 'Playback aborted',
        2: 'Network error while loading video',
        3: 'Decode error — codec not supported',
        4: 'Source format not supported',
      };
      setError(code ? map[code] ?? `Error ${code}` : 'Video error');
    };

    v.addEventListener('play', onPlay);
    v.addEventListener('pause', onPause);
    v.addEventListener('loadedmetadata', onLoaded);
    v.addEventListener('durationchange', onLoaded);
    v.addEventListener('timeupdate', onTime);
    v.addEventListener('progress', onProgress);
    v.addEventListener('ended', onEnded);
    v.addEventListener('error', onError);
    return () => {
      v.removeEventListener('play', onPlay);
      v.removeEventListener('pause', onPause);
      v.removeEventListener('loadedmetadata', onLoaded);
      v.removeEventListener('durationchange', onLoaded);
      v.removeEventListener('timeupdate', onTime);
      v.removeEventListener('progress', onProgress);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('error', onError);
    };
  }, [loop, onTimeUpdate]);

  // Reset error/no-track state when src changes
  useEffect(() => {
    setError(null);
    setNoVideoTrack(false);
    setAutoTried(false);
  }, [src]);

  // Listen for seek requests from outside (e.g., scene-timeline clicks).
  // `seekToken` increments on each request so repeated seeks to the same time still fire.
  const seekTime = useEditorAIStore((s) => s.seekTime);
  const seekToken = useEditorAIStore((s) => s.seekToken);
  const setStoreCurrentTime = useEditorAIStore((s) => s.setCurrentTime);
  const setStoreVideoDuration = useEditorAIStore((s) => s.setVideoDuration);
  const frameTransform = useEditorAIStore((s) => s.frameTransform);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (seekToken === 0) return; // initial value, ignore
    v.currentTime = Math.max(0, Math.min(v.duration || 0, seekTime));
  }, [seekToken, seekTime]);

  // Publish current time to the store so panels can highlight the active scene
  useEffect(() => {
    setStoreCurrentTime(currentTime);
  }, [currentTime, setStoreCurrentTime]);

  // Publish real video duration so the trim scrubber maps drag positions to real seconds.
  useEffect(() => {
    setStoreVideoDuration(duration);
  }, [duration, setStoreVideoDuration]);

  // Auto-trigger optimization once when undecodable video is detected
  useEffect(() => {
    if ((noVideoTrack || error) && onRequestOptimize && !autoTried && !optimizing) {
      setAutoTried(true);
      onRequestOptimize();
    }
  }, [noVideoTrack, error, onRequestOptimize, autoTried, optimizing]);

  // ─── Fullscreen tracking ────────────────────────────────────────────────
  useEffect(() => {
    const handler = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  // Clean up hide timer on unmount
  useEffect(() => () => { if (hideTimerRef.current) clearTimeout(hideTimerRef.current); }, []);

  // ─── Helpers ────────────────────────────────────────────────────────────
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => undefined);
    else v.pause();
  }, []);

  const seekBy = useCallback((delta: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min((v.duration || 0), v.currentTime + delta));
  }, []);

  const seekTo = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, t));
  }, []);

  const toggleMute = useCallback(() => setMuted((m) => !m), []);

  const toggleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    else containerRef.current.requestFullscreen().catch(() => undefined);
  }, []);

  const cycleRate = useCallback(() => {
    setRate((r) => {
      const i = PLAYBACK_RATES.indexOf(r);
      const next = PLAYBACK_RATES[(i + 1) % PLAYBACK_RATES.length] ?? 1;
      if (videoRef.current) videoRef.current.playbackRate = next;
      return next;
    });
  }, []);

  // Show controls on activity; auto-hide after 2.5 s of inactivity
  const showControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 2500);
  }, []);

  // Always show controls while paused, dragging scrubber, or on error
  const controlsShouldShow = controlsVisible || !playing || dragging || !!error || !!noVideoTrack;

  // Apply muted/volume/rate to video
  useEffect(() => { if (videoRef.current) videoRef.current.muted = muted; }, [muted]);
  useEffect(() => { if (videoRef.current) videoRef.current.volume = volume; }, [volume]);

  // When effects include speed-ramp, force the rate even if the user's selection differs.
  const effectsRate = getPlaybackRateForEffects(effects);
  const appliedRate = effectsRate ?? rate;
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = appliedRate;
  }, [appliedRate]);

  // ─── Keyboard shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip when typing in inputs
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      switch (e.code) {
        case 'Space':
          e.preventDefault(); togglePlay(); break;
        case 'ArrowLeft':
          e.preventDefault(); seekBy(e.shiftKey ? -5 : -frame); break;
        case 'ArrowRight':
          e.preventDefault(); seekBy(e.shiftKey ? 5 : frame); break;
        case 'KeyJ':
          e.preventDefault(); seekBy(-5); break;
        case 'KeyK':
          e.preventDefault(); togglePlay(); break;
        case 'KeyL':
          e.preventDefault(); seekBy(5); break;
        case 'KeyM':
          e.preventDefault(); toggleMute(); break;
        case 'KeyF':
          e.preventDefault(); toggleFullscreen(); break;
        case 'Home':
          e.preventDefault(); seekTo(0); break;
        case 'End':
          e.preventDefault(); seekTo(duration); break;
        case 'Digit0': case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4':
        case 'Digit5': case 'Digit6': case 'Digit7': case 'Digit8': case 'Digit9': {
          const n = parseInt(e.code.slice(-1), 10);
          e.preventDefault(); seekTo((duration * n) / 10); break;
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePlay, seekBy, seekTo, toggleMute, toggleFullscreen, duration, frame]);

  // ─── Scrubber drag handling ─────────────────────────────────────────────
  const positionToTime = (clientX: number): number => {
    const rect = scrubberRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * duration;
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (e: MouseEvent) => seekTo(positionToTime(e.clientX));
    const up = () => setDragging(false);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [dragging, duration]); // eslint-disable-line react-hooks/exhaustive-deps

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const bufferPct = duration > 0 ? (buffered / duration) * 100 : 0;
  const hoverPct = scrubHover !== null && duration > 0 ? (scrubHover / duration) * 100 : null;
  const currentFrame = Math.floor(currentTime * fps);
  const totalFrames = Math.floor(duration * fps);

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      className={clsx('relative bg-black select-none', className, playing && !controlsVisible && 'cursor-none')}
      onMouseMove={showControls}
      onMouseEnter={showControls}
    >
      {/* Video surface fills entire container; controls overlay at bottom */}
      <div className="absolute inset-0 overflow-hidden flex items-center justify-center">
        <video
          ref={videoRef}
          src={src}
          className={clsx(
            'absolute inset-0 w-full h-full object-contain block',
            effects.includes('handheld-shake') && 'animate-[vc-shake_0.6s_ease-in-out_infinite]'
          )}
          style={{
            filter: buildVideoFilter(effects) || undefined,
            willChange: 'transform',
            transform: [
              buildCropTransformCss(frameTransform),
              buildFrameTransformCss(frameTransform),
              buildVideoTransform(effects),
            ]
              .filter(Boolean)
              .join(' ') || undefined,
            transformOrigin: 'center center',
            transition: 'transform 0.3s ease',
          }}
          onClick={togglePlay}
          onDoubleClick={toggleFullscreen}
          preload="metadata"
        />
        <EffectOverlay
          effects={effects}
          subtitleStyle={subtitleStyle}
          className="absolute inset-0"
        />
        <TransformOverlay transform={frameTransform} className="absolute inset-0" />

        {/* Active-effects chip strip — small floating indicator */}
        {(effects.length > 0 || (transition && transition !== 'cut')) && (
          <div className="absolute top-2 left-2 flex flex-wrap gap-1 max-w-[60%] pointer-events-none">
            {effects.slice(0, 4).map((fx) => (
              <span
                key={fx}
                className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-accent-primary/80 text-white backdrop-blur-sm"
              >
                {fx}
              </span>
            ))}
            {effects.length > 4 && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-black/60 text-white">
                +{effects.length - 4}
              </span>
            )}
            {transition && transition !== 'cut' && (
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-500/80 text-white">
                → {transition}
              </span>
            )}
          </div>
        )}

        {/* Big center play indicator (only when paused, fades in/out) */}
        {!playing && duration > 0 && !error && !noVideoTrack && (
          <button
            onClick={togglePlay}
            className="absolute inset-0 flex items-center justify-center group"
            aria-label={t('editor.player.play')}
          >
            <div className="w-16 h-16 rounded-full bg-black/50 backdrop-blur-sm border border-white/20 flex items-center justify-center group-hover:bg-accent-primary/70 group-hover:scale-110 transition-all">
              <Play className="w-6 h-6 text-white fill-white ml-0.5" />
            </div>
          </button>
        )}

        {/* Codec failure / black-screen overlay */}
        {(error || noVideoTrack) && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/85 backdrop-blur-sm p-6">
            <div className="max-w-md text-center">
              {optimizing ? (
                <>
                  <div className="w-10 h-10 mx-auto mb-3 rounded-full border-2 border-accent-primary border-t-transparent animate-spin" />
                  <div className="text-sm font-medium text-white mb-1">
                    {t('editor.player.reencodingTitle')}
                  </div>
                  <div className="text-xs text-white/60 leading-relaxed">
                    {t('editor.player.reencodingHint')}
                  </div>
                </>
              ) : (
                <>
                  <AlertTriangle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
                  <div className="text-sm font-medium text-white mb-1">
                    {noVideoTrack
                      ? t('editor.player.videoTrackNotPlayable')
                      : t('editor.player.playbackError')}
                  </div>
                  <div className="text-xs text-white/60 mb-4 leading-relaxed">
                    {error ? error : t('editor.player.codecExplain')}
                    {autoTried && ` ${t('editor.player.reencodeFailed')}`}
                  </div>
                  {onRequestOptimize && (
                    <button
                      onClick={() => { setAutoTried(true); onRequestOptimize(); }}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent-primary hover:bg-accent-hover text-white text-xs font-medium transition-colors"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      {autoTried
                        ? t('editor.player.retryOptimize')
                        : t('editor.player.optimizeForPreview')}
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* Control bar — inside the same stacking context as the video so z-index works reliably */}
        <div
          className={clsx(
            'absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 to-transparent px-3 py-2 z-20 transition-opacity duration-200',
            controlsShouldShow ? 'opacity-100' : 'opacity-0 pointer-events-none'
          )}
        >
        {/* Scrubber */}
        <div
          ref={scrubberRef}
          className="relative h-2 mb-2 group cursor-pointer"
          onMouseDown={(e) => { setDragging(true); seekTo(positionToTime(e.clientX)); }}
          onMouseMove={(e) => setScrubHover(positionToTime(e.clientX))}
          onMouseLeave={() => setScrubHover(null)}
        >
          {/* Track background */}
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 group-hover:h-1.5 bg-white/10 rounded-full transition-all" />
          {/* Buffered */}
          <div
            className="absolute top-1/2 -translate-y-1/2 left-0 h-1 group-hover:h-1.5 bg-white/20 rounded-full transition-all"
            style={{ width: `${bufferPct}%` }}
          />
          {/* Played */}
          <div
            className="absolute top-1/2 -translate-y-1/2 left-0 h-1 group-hover:h-1.5 bg-accent-primary rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
          {/* Hover indicator */}
          {hoverPct !== null && (
            <>
              <div
                className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3 bg-white/60 rounded-full pointer-events-none"
                style={{ left: `${hoverPct}%` }}
              />
              <div
                className="absolute -top-7 -translate-x-1/2 px-1.5 py-0.5 rounded bg-black/90 border border-white/10 text-[10px] text-white font-mono pointer-events-none whitespace-nowrap"
                style={{ left: `${hoverPct}%` }}
              >
                {formatTime(scrubHover ?? 0)}
              </div>
            </>
          )}
          {/* Playhead */}
          <div
            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-accent-primary border-2 border-white shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ left: `${progress}%` }}
          />
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-1">
          {/* Play / Pause */}
          <button
            onClick={togglePlay}
            className="p-1.5 rounded hover:bg-white/10 text-white transition-colors"
            title={playing ? t('editor.player.pause') : t('editor.player.play')}
          >
            {playing ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white" />}
          </button>

          {/* Skip back 5s */}
          <button
            onClick={() => seekBy(-5)}
            className="p-1.5 rounded hover:bg-white/10 text-white/80 hover:text-white transition-colors"
            title={t('editor.player.back5s')}
          >
            <SkipBack className="w-3.5 h-3.5" />
          </button>

          {/* Frame -1 */}
          <button
            onClick={() => seekBy(-frame)}
            className="p-1.5 rounded hover:bg-white/10 text-white/80 hover:text-white transition-colors"
            title={t('editor.player.prevFrame')}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>

          {/* Frame +1 */}
          <button
            onClick={() => seekBy(frame)}
            className="p-1.5 rounded hover:bg-white/10 text-white/80 hover:text-white transition-colors"
            title={t('editor.player.nextFrame')}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>

          {/* Skip forward 5s */}
          <button
            onClick={() => seekBy(5)}
            className="p-1.5 rounded hover:bg-white/10 text-white/80 hover:text-white transition-colors"
            title={t('editor.player.forward5s')}
          >
            <SkipForward className="w-3.5 h-3.5" />
          </button>

          {/* Time / Frame display */}
          <div className="ml-2 flex items-baseline gap-1 font-mono text-[11px] tabular-nums">
            <span className="text-white">{formatTime(currentTime)}</span>
            <span className="text-white/40">/</span>
            <span className="text-white/60">{formatTime(duration)}</span>
            <span className="ml-2 text-white/40 hidden sm:inline">
              {t('editor.player.frame')} {currentFrame}/{totalFrames}
            </span>
          </div>

          {/* Spacer */}
          <div className="flex-1" />

          {/* Loop */}
          <button
            onClick={() => setLoop((l) => !l)}
            className={clsx(
              'p-1.5 rounded transition-colors',
              loop ? 'text-accent-hover bg-accent-muted' : 'text-white/60 hover:text-white hover:bg-white/10'
            )}
            title={t('editor.player.loop')}
          >
            <Repeat className="w-3.5 h-3.5" />
          </button>

          {/* Screenshot */}
          <button
            onClick={() => {
              const v = videoRef.current;
              if (!v) return;
              const canvas = document.createElement('canvas');
              canvas.width = v.videoWidth;
              canvas.height = v.videoHeight;
              canvas.getContext('2d')?.drawImage(v, 0, 0);
              canvas.toBlob((blob) => {
                if (!blob) return;
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `frame-${currentFrame}.png`;
                a.click();
                URL.revokeObjectURL(url);
              });
            }}
            className="p-1.5 rounded hover:bg-white/10 text-white/60 hover:text-white transition-colors"
            title={t('editor.player.captureFrame')}
          >
            <Camera className="w-3.5 h-3.5" />
          </button>

          {/* Playback rate */}
          <button
            onClick={cycleRate}
            className="px-2 py-1 rounded text-[11px] font-mono font-medium hover:bg-white/10 text-white/80 hover:text-white transition-colors min-w-[2.5rem]"
            title={t('editor.player.playbackSpeed')}
          >
            {rate}×
          </button>

          {/* Volume */}
          <div className="flex items-center gap-1 group/vol">
            <button
              onClick={toggleMute}
              className="p-1.5 rounded hover:bg-white/10 text-white/80 hover:text-white transition-colors"
              title={muted ? t('editor.player.unmute') : t('editor.player.mute')}
            >
              {muted || volume === 0 ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                setVolume(v);
                if (v > 0 && muted) setMuted(false);
              }}
              className="w-16 h-1 accent-c-accent opacity-0 group-hover/vol:opacity-100 transition-opacity"
            />
          </div>

          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded hover:bg-white/10 text-white/80 hover:text-white transition-colors"
            title={fullscreen ? t('editor.player.exitFullscreen') : t('editor.player.fullscreen')}
          >
            {fullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

