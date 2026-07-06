import clsx from 'clsx';
import {
  ArrowRight,
  Clock,
  GripVertical,
  Move,
  Pause,
  Play,
  RefreshCw,
  Shuffle,
  SkipBack,
  SkipForward,
  Trash2,
  Video,
  Volume2,
  ZoomIn,
} from 'lucide-react';
import type { MotionEffect } from '../../../lib/api';
import { useStoryboard } from '../StoryboardContext';
import { fmtTime, parseTimeInput } from '../utils';
import { MusicPanel } from './MusicPanel';

export function TimelineStep() {
  const {
    t,
    segments,
    setSegments,
    hoveredSegment,
    setHoveredSegment,
    playingSegment,
    setPlayingSegment,
    playheadTime,
    setPlayheadTime,
    isAudioPaused,
    segmentRefs,
    timelineTrackRef,
    trackDragRef,
    manualScrolling,
    trackZoom,
    setTrackZoom,
    trackHeight,
    setTrackHeight,
    trackGrabbing,
    setTrackGrabbing,
    allEffects,
    randomEffects,
    setRandomEffects,
    bgMusicFilename,
    setBgMusicFilename,
    voiceVolume,
    setVoiceVolume,
    musicVolume,
    setMusicVolume,
    dragIdx,
    dragOverIdx,
    dragAllowed,
    handleDragStart,
    handleDragOver,
    handleDrop,
    setDragIdx,
    setDragOverIdx,
    updateSegmentTimeAutoMerge,
    handleTrackEdgeDrag,
    handleCardResizeStart,
    updateSegmentMotion,
    playSegmentAudio,
    pauseAudio,
    resumeAudio,
    stopAudio,
    skipSegment,
    seekToTime,
    handleBuildTimeline,
    audioFile,
    saveProject,
    setStep,
    setLightboxUrl,
    aspectRatio,
    setAspectRatio,
    segAudioRef,
    segmentsRef,
    timeFormat,
    setTimeFormat,
    frameTransition,
    setFrameTransition,
    frameHoldTime,
    setFrameHoldTime,
  } = useStoryboard();

  // Computed values
  const totalDuration = segments.length > 0 ? segments[segments.length - 1]?.endTime || 0 : 0;
  const maxSegDuration = segments.length > 0 ? Math.max(...segments.map(s => s.endTime - s.startTime)) : 1;

  // Local helpers (same as in AssembleStep)
  const setAllMotion = (motion: MotionEffect) => {
    setSegments((prev) => {
      const updated = prev.map((s) => ({ ...s, motion }));
      saveProject({ segments: updated });
      return updated;
    });
  };

  const toggleRandomEffect = (effect: MotionEffect) => {
    setRandomEffects((prev) => {
      const next = new Set(prev);
      if (next.has(effect)) next.delete(effect); else next.add(effect);
      return next;
    });
  };

  const randomizeMotion = () => {
    const pool = Array.from(randomEffects);
    if (!pool.length) return;
    setSegments((prev) => {
      const updated = prev.map((s) => ({ ...s, motion: pool[Math.floor(Math.random() * pool.length)] }));
      saveProject({ segments: updated });
      return updated;
    });
  };

  return (
    <div className="space-y-3">
      {/* Header card */}
      <div className="border border-c-border rounded-xl bg-c-surface p-4 space-y-3">
        {/* Title row */}
        <div className="flex items-center gap-3 flex-wrap">
          <h3 className="text-base font-medium text-c-text flex items-center gap-2">
            <Clock className="w-4.5 h-4.5 text-cyan-400" />
            {t('storyboard.stepTimeline')}
          </h3>
          <span className="text-xs text-c-dim bg-c-bg rounded-full px-3 py-0.5 border border-c-border">{segments.length} {t('storyboard.segments')}</span>
          {segments.length > 0 && (
            <span className="text-xs text-c-dim bg-c-bg rounded-full px-3 py-0.5 border border-c-border">
              {fmtTime(totalDuration)} {t('storyboard.total')}
            </span>
          )}
          <div className="flex items-center gap-2 ml-auto">
            <select value={timeFormat} onChange={(e) => setTimeFormat(e.target.value as 'seconds' | 'minutes')} className="input text-xs py-1 w-auto">
              <option value="seconds">{t('storyboard.timeSeconds')}</option>
              <option value="minutes">{t('storyboard.timeMinutes')}</option>
            </select>
            <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="input text-xs py-1">
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
            </select>
          </div>
        </div>

        {/* Background Music & Volume Controls */}
        <MusicPanel
          bgMusicFilename={bgMusicFilename}
          setBgMusicFilename={(f) => { setBgMusicFilename(f); saveProject({ bgMusicFilename: f }); }}
          voiceVolume={voiceVolume}
          setVoiceVolume={(v) => { setVoiceVolume(v); saveProject({ voiceVolume: v }); }}
          musicVolume={musicVolume}
          setMusicVolume={(v) => { setMusicVolume(v); saveProject({ musicVolume: v }); }}
          totalDuration={totalDuration}
          t={t}
        />

        {/* CapCut-style visual timeline track */}
        {segments.length > 0 && totalDuration > 0 && (() => {
          const pxPerSec = trackZoom;
          const trackWidth = totalDuration * pxPerSec;
          // Time ruler ticks
          const tickInterval = totalDuration <= 10 ? 1 : totalDuration <= 30 ? 2 : totalDuration <= 60 ? 5 : 10;
          const ticks: number[] = [];
          for (let t = 0; t <= totalDuration; t += tickInterval) ticks.push(t);
          if (ticks[ticks.length - 1] < totalDuration) ticks.push(totalDuration);
          return (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-c-dim font-medium">{t('storyboard.timelineOverview')}</span>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-c-dim">W</span>
                  <button
                    onClick={() => setTrackZoom(Math.max(30, trackZoom - 30))}
                    className="w-5 h-5 rounded flex items-center justify-center text-c-muted hover:text-c-text hover:bg-c-hover transition-colors border border-c-border text-[10px] font-bold"
                  >−</button>
                  <button
                    onClick={() => setTrackZoom(Math.min(400, trackZoom + 30))}
                    className="w-5 h-5 rounded flex items-center justify-center text-c-muted hover:text-c-text hover:bg-c-hover transition-colors border border-c-border text-[10px] font-bold"
                  >+</button>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-[9px] text-c-dim">H</span>
                  <button
                    onClick={() => setTrackHeight(Math.max(80, trackHeight - 40))}
                    className="w-5 h-5 rounded flex items-center justify-center text-c-muted hover:text-c-text hover:bg-c-hover transition-colors border border-c-border text-[10px] font-bold"
                  >−</button>
                  <button
                    onClick={() => setTrackHeight(Math.min(500, trackHeight + 40))}
                    className="w-5 h-5 rounded flex items-center justify-center text-c-muted hover:text-c-text hover:bg-c-hover transition-colors border border-c-border text-[10px] font-bold"
                  >+</button>
                </div>
              </div>
            </div>
            <div className="relative border border-c-border rounded-xl bg-c-bg overflow-hidden">
              {/* Fixed center playhead — stays in middle, track scrolls underneath */}
              {playheadTime !== null && (
                <div className="absolute left-1/2 top-0 bottom-0 z-30 pointer-events-none -translate-x-1/2">
                  <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-red-500 rounded-full shadow-md shadow-red-500/40 border-2 border-white/80" />
                  <div className="w-0.5 h-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.5)] mx-auto" />
                </div>
              )}
              <div
                className={clsx('overflow-x-auto scrollbar-thin', trackGrabbing ? 'cursor-grabbing' : 'cursor-grab')}
                ref={timelineTrackRef}
                style={{ scrollBehavior: 'auto' }}
                onMouseDown={(e) => {
                  if ((e.target as HTMLElement).closest('[data-edge-handle]')) return;
                  const el = timelineTrackRef.current;
                  if (!el) return;
                  e.preventDefault();
                  manualScrolling.current = true;
                  trackDragRef.current = { startX: e.clientX, scrollLeft: el.scrollLeft, raf: null };
                  setTrackGrabbing(true);
                  let targetScroll = el.scrollLeft;
                  const onMove = (me: MouseEvent) => {
                    if (!trackDragRef.current) return;
                    targetScroll = trackDragRef.current.scrollLeft - (me.clientX - trackDragRef.current.startX);
                    if (!trackDragRef.current.raf) {
                      trackDragRef.current.raf = requestAnimationFrame(() => {
                        if (trackDragRef.current) trackDragRef.current.raf = null;
                        el.scrollLeft = targetScroll;
                      });
                    }
                  };
                  const onUp = () => {
                    if (trackDragRef.current?.raf) cancelAnimationFrame(trackDragRef.current.raf);
                    trackDragRef.current = null;
                    setTrackGrabbing(false);
                    // Seek audio to where the center red line now points
                    const centerTime = (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth * totalDuration;
                    const clampedTime = Math.max(0, Math.min(totalDuration, centerTime));
                    if (segAudioRef.current && playingSegment !== null) {
                      segAudioRef.current.currentTime = clampedTime;
                    }
                    setPlayheadTime(clampedTime);
                    const segs = segmentsRef.current;
                    const ai = segs.findIndex((s, si) => clampedTime >= s.startTime && (si === segs.length - 1 ? clampedTime <= s.endTime : clampedTime < s.endTime));
                    if (ai >= 0) setPlayingSegment(ai);
                    manualScrolling.current = false;
                    window.removeEventListener('mousemove', onMove);
                    window.removeEventListener('mouseup', onUp);
                  };
                  window.addEventListener('mousemove', onMove);
                  window.addEventListener('mouseup', onUp);
                }}
                onTouchStart={(e) => {
                  const el = timelineTrackRef.current;
                  if (!el) return;
                  manualScrolling.current = true;
                  const touch = e.touches[0];
                  trackDragRef.current = { startX: touch.clientX, scrollLeft: el.scrollLeft, raf: null };
                  let targetScroll = el.scrollLeft;
                  const onMove = (te: TouchEvent) => {
                    if (!trackDragRef.current) return;
                    targetScroll = trackDragRef.current.scrollLeft - (te.touches[0].clientX - trackDragRef.current.startX);
                    if (!trackDragRef.current.raf) {
                      trackDragRef.current.raf = requestAnimationFrame(() => {
                        if (trackDragRef.current) trackDragRef.current.raf = null;
                        el.scrollLeft = targetScroll;
                      });
                    }
                  };
                  const onEnd = () => {
                    if (trackDragRef.current?.raf) cancelAnimationFrame(trackDragRef.current.raf);
                    trackDragRef.current = null;
                    const centerTime = (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth * totalDuration;
                    const clampedTime = Math.max(0, Math.min(totalDuration, centerTime));
                    if (segAudioRef.current && playingSegment !== null) {
                      segAudioRef.current.currentTime = clampedTime;
                    }
                    setPlayheadTime(clampedTime);
                    const segs = segmentsRef.current;
                    const ai = segs.findIndex((s, si) => clampedTime >= s.startTime && (si === segs.length - 1 ? clampedTime <= s.endTime : clampedTime < s.endTime));
                    if (ai >= 0) setPlayingSegment(ai);
                    manualScrolling.current = false;
                    window.removeEventListener('touchmove', onMove);
                    window.removeEventListener('touchend', onEnd);
                  };
                  window.addEventListener('touchmove', onMove, { passive: true });
                  window.addEventListener('touchend', onEnd);
                }}
              >
                <div className="relative" style={{ width: `${trackWidth}px`, minWidth: '100%' }}>
                  {/* Time ruler */}
                  <div className="relative h-5 border-b border-c-border/60 bg-c-surface/50">
                    {ticks.map((tick) => (
                      <div key={tick} className="absolute top-0 h-full flex flex-col items-center" style={{ left: `${(tick / totalDuration) * 100}%` }}>
                        <div className="w-px h-2 bg-c-dim/40" />
                        <span className="text-[8px] font-mono text-c-dim/70 mt-px leading-none">{fmtTime(tick)}</span>
                      </div>
                    ))}
                  </div>
                  {/* Video track — thumbnail strip with draggable edges */}
                  <div className="relative flex" style={{ height: `${trackHeight}px` }}>
                    {segments.map((seg, i) => {
                      const dur = seg.endTime - seg.startTime;
                      const widthPct = (dur / totalDuration) * 100;
                      const isHovered = hoveredSegment === i;
                      const isPlaying = playingSegment === i;
                      return (
                        <div key={i} className="relative h-full shrink-0 grow-0" style={{ width: `${widthPct}%`, minWidth: '4px' }}>
                          {/* Segment body */}
                          <button
                            className={clsx(
                              'relative w-full h-full flex flex-col justify-between overflow-hidden transition-shadow duration-150 group/track',
                              isPlaying ? 'ring-2 ring-inset ring-cyan-400 z-10 brightness-150 saturate-150' :
                              isHovered ? 'ring-2 ring-inset ring-cyan-500/40 z-10' : '',
                            )}
                            style={{
                              background: `hsl(${(i * 30 + 200) % 360}, ${isPlaying ? '60%' : '45%'}, ${isPlaying ? '35%' : isHovered ? '28%' : '18%'})`,
                              boxShadow: isPlaying ? `inset 0 0 20px rgba(6, 182, 212, 0.3), 0 0 12px rgba(6, 182, 212, 0.2)` : undefined,
                            }}
                            onMouseEnter={() => setHoveredSegment(i)}
                            onMouseLeave={() => setHoveredSegment(null)}
                            onClick={() => {
                              setHoveredSegment(i);
                              if (audioFile) playSegmentAudio(i);
                            }}
                            aria-label={t('storyboard.segmentOf', { current: i + 1, total: segments.length })}
                          >
                            {/* Thumbnail fill */}
                            {(() => {
                              const segIsVideo = seg.mediaType === 'video' || /\.(mp4|webm|mov)$/i.test(seg.videoFilename || seg.imageFilename || '');
                              const videoSrc = seg.videoUrl || (segIsVideo ? seg.imageUrl : '');
                              if (segIsVideo && videoSrc) {
                                return <video src={`${videoSrc}#t=0.1`} className={clsx(
                                  'absolute inset-0 w-full h-full object-cover transition-opacity duration-150',
                                  isPlaying ? 'opacity-80' : 'opacity-50 group-hover/track:opacity-70'
                                )} muted preload="metadata" />;
                              }
                              if (seg.imageUrl) {
                                return <img src={seg.imageUrl} alt="" className={clsx(
                                  'absolute inset-0 w-full h-full object-cover transition-opacity duration-150',
                                  isPlaying ? 'opacity-80' : 'opacity-50 group-hover/track:opacity-70'
                                )} />;
                              }
                              return null;
                            })()}
                            {/* Top: time range */}
                            <div className="relative z-10 flex items-center justify-between px-1.5 pt-1 w-full">
                              <span className="text-[9px] font-mono text-white/60 drop-shadow">{fmtTime(seg.startTime)}</span>
                              <span className="text-[9px] font-mono text-white/60 drop-shadow">{fmtTime(seg.endTime)}</span>
                            </div>
                            {/* Bottom: segment number + duration */}
                            <div className="relative z-10 flex items-center gap-1 px-1.5 pb-1 w-full">
                              <span className="text-[10px] font-bold text-white/90 drop-shadow-md">{i + 1}</span>
                              <span className="text-[9px] font-mono text-white/70 drop-shadow truncate">{dur.toFixed(1)}s</span>
                            </div>
                          </button>
                          {/* Draggable right edge handle (between this and next segment) */}
                          {i < segments.length - 1 && (
                            <div
                              data-edge-handle
                              className="absolute top-0 -right-[5px] w-[10px] h-full z-20 cursor-col-resize flex items-center justify-center group/edge"
                              onMouseDown={(e) => handleTrackEdgeDrag(e, i)}
                              title={t('storyboard.dragToResize')}
                            >
                              <div className="w-[3px] h-8 rounded-full bg-white/20 group-hover/edge:bg-cyan-400 group-hover/edge:h-12 group-hover/edge:shadow-[0_0_8px_rgba(6,182,212,0.5)] transition-all" />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* Audio track hint */}
                  {audioFile && (
                    <div className="relative h-6 border-t border-c-border/40 bg-c-surface/30 flex items-center px-2 gap-1.5">
                      <Volume2 className="w-3 h-3 text-cyan-400/60 shrink-0" />
                      <div className="flex-1 h-2 rounded-full bg-cyan-500/15 overflow-hidden">
                        <div className="h-full bg-cyan-500/30 rounded-full" style={{ width: '100%' }} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          );
        })()}

        {/* Player transport controls */}
        {audioFile && segments.length > 0 && (
          <div className="flex items-center gap-3 bg-c-bg rounded-lg border border-c-border px-3 py-2">
            {/* Play / Pause / Skip */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => skipSegment(-1)}
                className="w-7 h-7 rounded-md flex items-center justify-center text-c-muted hover:text-c-text hover:bg-c-hover transition-colors"
                aria-label="Previous segment"
              >
                <SkipBack className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => {
                  if (playingSegment === null) {
                    playSegmentAudio(0);
                  } else if (isAudioPaused) {
                    resumeAudio();
                  } else {
                    pauseAudio();
                  }
                }}
                className={clsx(
                  'w-9 h-9 rounded-full flex items-center justify-center transition-all',
                  playingSegment !== null && !isAudioPaused
                    ? 'bg-cyan-500 text-white shadow-md shadow-cyan-500/30 hover:bg-cyan-400'
                    : 'bg-c-elevated border border-c-border text-c-text hover:bg-c-hover hover:border-cyan-500/50'
                )}
                aria-label={playingSegment !== null && !isAudioPaused ? t('storyboard.pausePlayback') : t('storyboard.playAll')}
              >
                {playingSegment !== null && !isAudioPaused
                  ? <Pause className="w-4 h-4" />
                  : <Play className="w-4 h-4 ml-0.5" />
                }
              </button>
              <button
                onClick={() => skipSegment(1)}
                className="w-7 h-7 rounded-md flex items-center justify-center text-c-muted hover:text-c-text hover:bg-c-hover transition-colors"
                aria-label="Next segment"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Time display */}
            <span className="text-[11px] font-mono text-c-muted tabular-nums w-20 text-center shrink-0">
              {fmtTime(playheadTime ?? 0)} / {fmtTime(totalDuration)}
            </span>

            {/* Scrubber */}
            <div
              className="flex-1 h-6 flex items-center cursor-pointer group/scrub"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                seekToTime(pct * totalDuration);
              }}
            >
              <div className="relative w-full h-1.5 bg-c-border rounded-full group-hover/scrub:h-2 transition-all">
                {/* Progress fill */}
                <div
                  className="absolute inset-y-0 left-0 bg-cyan-500 rounded-full transition-[width] duration-75"
                  style={{ width: `${totalDuration > 0 ? ((playheadTime ?? 0) / totalDuration) * 100 : 0}%` }}
                />
                {/* Scrub handle */}
                {playheadTime !== null && (
                  <div
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-cyan-400 rounded-full shadow-md opacity-0 group-hover/scrub:opacity-100 transition-opacity"
                    style={{ left: `${(playheadTime / totalDuration) * 100}%` }}
                  />
                )}
              </div>
            </div>

            {/* Segment indicator */}
            <span className="text-[10px] text-c-dim shrink-0">
              {playingSegment !== null
                ? t('storyboard.segmentOf', { current: playingSegment + 1, total: segments.length })
                : `${segments.length} ${t('storyboard.segments')}`
              }
            </span>

            {/* Volume icon */}
            <Volume2 className="w-3.5 h-3.5 text-c-dim shrink-0" />
          </div>
        )}

        {/* Bulk motion controls */}
        {segments.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap border-t border-c-border pt-3">
            <Move className="w-3.5 h-3.5 text-c-dim shrink-0" />
            <span className="text-[10px] text-c-dim font-medium shrink-0">{t('storyboard.bulkMotion')}:</span>
            <select
              onChange={(e) => { if (e.target.value) setAllMotion(e.target.value as MotionEffect); }}
              className="input text-[10px] py-0.5 w-24"
              defaultValue=""
            >
              <option value="" disabled>{t('storyboard.motionAll')}</option>
              {allEffects.map((fx) => (
                <option key={fx} value={fx}>{t(`storyboard.motion${fx.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('')}` as any)}</option>
              ))}
            </select>
            <button
              onClick={randomizeMotion}
              disabled={randomEffects.size === 0}
              className="btn-ghost text-[10px] py-0.5 px-2 flex items-center gap-1 disabled:opacity-40"
            >
              <Shuffle className="w-3 h-3" /> {t('storyboard.randomize')}
            </button>
            <div className="hidden sm:flex items-center gap-1 ml-1 flex-wrap">
              {allEffects.filter(fx => fx !== 'static').map((fx) => (
                <label key={fx} className="flex items-center gap-0.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={randomEffects.has(fx)}
                    onChange={() => toggleRandomEffect(fx)}
                    className="w-2.5 h-2.5 rounded accent-cyan-500"
                  />
                  <span className="text-[9px] text-c-dim">{t(`storyboard.motion${fx.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('')}` as any)}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* Frame transition controls */}
        <div className="flex items-center gap-3 flex-wrap border-t border-c-border pt-3">
          <Clock className="w-3.5 h-3.5 text-c-dim shrink-0" />
          <span className="text-[10px] text-c-dim font-medium shrink-0">{t('storyboard.frameChange')}:</span>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="frameTransition"
              checked={frameTransition === 'voice'}
              onChange={() => setFrameTransition('voice')}
              className="w-3 h-3 accent-cyan-500"
            />
            <span className="text-[10px] text-c-text">{t('storyboard.onVoiceEnd')}</span>
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="frameTransition"
              checked={frameTransition === 'hold'}
              onChange={() => setFrameTransition('hold')}
              className="w-3 h-3 accent-cyan-500"
            />
            <span className="text-[10px] text-c-text">{t('storyboard.holdAfterVoice')}</span>
          </label>
          {frameTransition === 'hold' && (
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-c-dim">{t('storyboard.holdTimeSec')}:</span>
              <input
                type="number"
                min={0}
                max={10}
                step={0.5}
                value={frameHoldTime}
                onChange={(e) => setFrameHoldTime(Math.max(0, Math.min(10, parseFloat(e.target.value) || 0)))}
                className="input text-[10px] w-14 py-0.5 font-mono text-center"
              />
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={handleBuildTimeline}
            className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" /> {t('storyboard.syncTimeline')}
          </button>
          <div className="flex-1" />
          <button
            onClick={() => { setStep('metadata'); saveProject({ currentStep: 'metadata' }); }}
            className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
          >
            {t('storyboard.stepMetadata')} <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Empty state */}
      {segments.length === 0 && (
        <div className="text-center py-12 space-y-2">
          <Clock className="w-10 h-10 mx-auto text-c-dim" />
          <p className="text-sm text-c-dim">{t('storyboard.noSegments')}</p>
        </div>
      )}

      {/* Segment cards — drag & drop reorder */}
      <div className="max-h-[calc(100vh-340px)] overflow-y-auto space-y-2 pr-1">
        {segments.map((seg, i) => {
          const dur = seg.endTime - seg.startTime;
          const durPct = maxSegDuration > 0 ? (dur / maxSegDuration) * 100 : 0;
          const isHovered = hoveredSegment === i;
          const isDragOver = dragOverIdx === i && dragIdx !== i;
          return (
          <div
            key={i}
            ref={(el) => { segmentRefs.current[i] = el; }}
            draggable
            onDragStart={(e) => handleDragStart(e, i)}
            onDragOver={(e) => handleDragOver(e, i)}
            onDragEnd={() => { dragAllowed.current = false; setDragIdx(null); setDragOverIdx(null); }}
            onDrop={(e) => handleDrop(e, i)}
            className={clsx(
              'rounded-lg border bg-c-surface transition-all duration-150 group',
              isDragOver ? 'border-cyan-400 border-dashed shadow-[0_0_16px_rgba(6,182,212,0.2)]' :
              playingSegment === i ? 'border-cyan-500/60 shadow-[0_0_16px_rgba(6,182,212,0.15)]' :
              isHovered ? 'border-cyan-500/50 shadow-[0_0_12px_rgba(6,182,212,0.1)]' : 'border-c-border hover:border-cyan-800/40',
              dragIdx === i && 'opacity-40',
            )}
            onMouseEnter={() => setHoveredSegment(i)}
            onMouseLeave={() => setHoveredSegment(null)}
          >
            <div className="flex items-start gap-3 p-3">
              {/* Index + drag handle */}
              <div className="flex flex-col items-center gap-1 shrink-0 pt-0.5">
                <span className={clsx(
                  'w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold transition-colors',
                  isHovered ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40' : 'bg-c-bg text-c-dim border border-c-border'
                )}>{i + 1}</span>
                <div
                  className="cursor-grab active:cursor-grabbing p-1.5 -m-1 rounded hover:bg-c-hover transition-colors"
                  onMouseDown={() => { dragAllowed.current = true; }}
                  title={t('storyboard.dragToReorder')}
                >
                  <GripVertical className="w-4 h-4 text-c-dim/50 hover:text-c-muted" />
                </div>
              </div>

              {/* Thumbnail + audio play */}
              {(() => {
                const thumbIsVid = seg.mediaType === 'video' || /\.(mp4|webm|mov)$/i.test(seg.videoFilename || seg.imageFilename || '');
                const thumbVidSrc = seg.videoUrl || (thumbIsVid ? seg.imageUrl : '');
                return (
              <div className="shrink-0 relative">
                <button
                  className="w-24 h-16 md:w-28 md:h-[4.5rem] rounded-md overflow-hidden relative group/thumb"
                  onClick={() => setLightboxUrl(thumbIsVid ? (thumbVidSrc || seg.imageUrl) : seg.imageUrl)}
                  aria-label={t('storyboard.segmentOf', { current: i + 1, total: segments.length })}
                >
                  {thumbIsVid && thumbVidSrc ? (
                    <video src={`${thumbVidSrc}#t=0.1`} className="w-full h-full object-cover" muted preload="metadata" />
                  ) : (
                    <img src={seg.imageUrl} alt={seg.text || `Segment ${i + 1}`} className="w-full h-full object-cover" />
                  )}
                  {thumbIsVid && <div className="absolute top-0.5 right-0.5 bg-violet-600/80 rounded px-1 text-[7px] text-white z-10">VID</div>}
                  <div className="absolute inset-0 bg-black/0 group-hover/thumb:bg-black/30 transition-colors flex items-center justify-center opacity-0 group-hover/thumb:opacity-100">
                    <ZoomIn className="w-4 h-4 text-white drop-shadow" />
                  </div>
                </button>
                {audioFile && (
                  <button
                    onClick={() => playSegmentAudio(i)}
                    className={clsx(
                      'absolute -bottom-1.5 -right-1.5 w-6 h-6 rounded-full flex items-center justify-center shadow-md transition-all',
                      playingSegment === i
                        ? 'bg-cyan-500 text-white scale-110'
                        : 'bg-c-elevated border border-c-border text-c-muted hover:text-cyan-400 hover:border-cyan-500/50'
                    )}
                    aria-label={playingSegment === i ? t('storyboard.stopPreview') : t('storyboard.previewAudio')}
                  >
                    {playingSegment === i
                      ? <Pause className="w-3 h-3" />
                      : <Play className="w-3 h-3 ml-0.5" />
                    }
                  </button>
                )}
              </div>
                );
              })()}

              {/* Content */}
              <div className="flex-1 min-w-0 space-y-2">
                {/* Text */}
                <div className="text-xs text-c-text leading-relaxed line-clamp-2" title={seg.text}>{seg.text || '—'}</div>

                {/* Draggable duration bar — drag right edge to resize, auto-merges */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-2.5 bg-c-bg rounded-full overflow-visible relative group/dur" ref={(el) => { if (el) el.dataset.segIdx = String(i); }}>
                    <div
                      className="h-full rounded-full relative"
                      style={{
                        width: `${durPct}%`,
                        background: `hsl(${(i * 30 + 200) % 360}, 55%, 50%)`,
                        minWidth: '12px',
                      }}
                    >
                      {/* Drag handle on right edge */}
                      <div
                        className="absolute top-1/2 -translate-y-1/2 -right-2 w-4 h-6 cursor-col-resize flex items-center justify-center group/handle"
                        onMouseDown={(e) => {
                          const bar = (e.currentTarget as HTMLElement).closest('[data-seg-idx]') as HTMLDivElement;
                          if (bar) handleCardResizeStart(e, i, bar);
                        }}
                        title={t('storyboard.dragToResize')}
                      >
                        <div className="w-1.5 h-4 bg-white/30 group-hover/handle:bg-cyan-400 group-hover/handle:w-1.5 group-hover/handle:h-5 rounded-full transition-all shadow-sm" />
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] font-mono text-c-dim shrink-0 w-10 text-right">{dur.toFixed(1)}s</span>
                </div>

                {/* Controls row */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Time inputs — auto-merge when extended past neighbor */}
                  <div className="flex items-center gap-1 shrink-0">
                    <input
                      type="text"
                      inputMode="decimal"
                      value={fmtTime(seg.startTime)}
                      onChange={(e) => updateSegmentTimeAutoMerge(i, 'startTime', parseTimeInput(e.target.value))}
                      className="input text-[10px] w-14 py-0.5 font-mono text-center"
                      aria-label={`${t('storyboard.start')} ${i + 1}`}
                    />
                    <span className="text-[10px] text-c-dim">–</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={fmtTime(seg.endTime)}
                      onChange={(e) => updateSegmentTimeAutoMerge(i, 'endTime', parseTimeInput(e.target.value))}
                      className="input text-[10px] w-14 py-0.5 font-mono text-center"
                      aria-label={`${t('storyboard.end')} ${i + 1}`}
                    />
                  </div>

                  {/* Motion select — disabled for video clips */}
                  {(seg.mediaType === 'video' || /\.(mp4|webm|mov)$/i.test(seg.videoFilename || seg.imageFilename || '')) ? (
                    <span className="text-[10px] text-violet-400 flex items-center gap-1"><Video className="w-3 h-3" /> {t('storyboard.videoClip')}</span>
                  ) : (
                    <select
                      value={seg.motion || 'static'}
                      onChange={(e) => updateSegmentMotion(i, e.target.value as MotionEffect)}
                      className="input text-[10px] py-0.5 w-24 shrink-0"
                      aria-label={`${t('storyboard.motion')} ${i + 1}`}
                    >
                      <option value="static">{t('storyboard.motionStatic')}</option>
                      <option value="zoom-in">{t('storyboard.motionZoomIn')}</option>
                      <option value="zoom-out">{t('storyboard.motionZoomOut')}</option>
                      <option value="pan-left">{t('storyboard.motionPanLeft')}</option>
                      <option value="pan-right">{t('storyboard.motionPanRight')}</option>
                      <option value="pan-up">{t('storyboard.motionPanUp')}</option>
                      <option value="pan-down">{t('storyboard.motionPanDown')}</option>
                    </select>
                  )}
                  <div className="flex-1" />
                  <button
                    onClick={() => {
                      const next = segments.filter((_, j) => j !== i);
                      setSegments(next);
                      saveProject({ segments: next });
                    }}
                    className="p-1 rounded text-c-dim hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                    title={t('storyboard.removeSegment')}
                    aria-label={t('storyboard.removeSegment')}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
          );
        })}
      </div>

    </div>
  );
}
