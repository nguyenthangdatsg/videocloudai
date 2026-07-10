import { useRef } from 'react';
import {
  Film, RefreshCw, Square, Download, CheckCircle, Copy, Tag, FileText, Mic, Image, Clock, Video, X,
} from 'lucide-react';
import { clsx } from 'clsx';
import { Spinner } from '../../../components/ui/Spinner';
import { useStoryboard } from '../StoryboardContext';
import type { MotionEffect } from '../../../lib/api';

export function AssembleStep() {
  const ctx = useStoryboard();
  const {
    t, segments, setSegments,
    allEffects, randomEffects, setRandomEffects,
    aspectRatio, setAspectRatio,
    speed, setSpeed, bgColor, setBgColor, saveProject,
    assembling, assembleAbortRef, assembleStep, assembleClipProgress,
    assembleProgress, assembleLogRef,
    result, handleAssemble,
    setLightboxUrl,
    metadataTitle, metadataDesc, metadataTags,
    scriptTopic, scriptText, projectName,
    audioFile, voice, generatedImages,
  } = ctx;

  const videoRef = useRef<HTMLVideoElement>(null);

  const toggleRandomEffect = (effect: MotionEffect) => {
    setRandomEffects(prev => {
      const next = new Set(prev);
      if (next.has(effect)) next.delete(effect);
      else next.add(effect);
      return next;
    });
  };

  const setAllMotion = (motion: MotionEffect) => {
    const updated = segments.map(s => ({ ...s, motion }));
    setSegments(updated);
    saveProject({ segments: updated });
  };

  const randomizeMotion = () => {
    const pool = Array.from(randomEffects);
    if (!pool.length) return;
    const updated = segments.map(s => ({ ...s, motion: pool[Math.floor(Math.random() * pool.length)] }));
    setSegments(updated);
    saveProject({ segments: updated });
  };

  const updateSegmentMotion = (idx: number, motion: MotionEffect) => {
    setSegments(prev => prev.map((s, i) => i === idx ? { ...s, motion } : s));
  };

  return (
    <div className="space-y-4">
      {!assembling && (
        <>
          <div className="border border-c-border rounded-xl p-3 bg-c-surface space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] text-c-dim font-medium">{t('storyboard.motionEffects')}:</span>
              {allEffects.map((fx) => (
                <label key={fx} className="flex items-center gap-1 cursor-pointer">
                  <input type="checkbox" checked={randomEffects.has(fx)} onChange={() => toggleRandomEffect(fx)} className="w-3 h-3 rounded accent-cyan-500" />
                  <span className="text-[10px] text-c-text">{t(`storyboard.motion${fx.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('')}` as never)}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} className="input text-xs">
                <option value="16:9">16:9</option>
                <option value="9:16">9:16</option>
                <option value="1:1">1:1</option>
              </select>
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-c-dim">Speed:</span>
                <select value={String(speed)} onChange={(e) => { const val = parseFloat(e.target.value); setSpeed(val); saveProject({ speed: val }); }} className="input text-xs py-1">
                  {[0.5, 0.6, 0.7, 0.75, 0.8, 0.9, 1, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4, 1.5, 1.6, 1.75, 2, 2.5, 3].map(v => (
                    <option key={v} value={String(v)}>{v === 1 ? '1.0x (Normal)' : `${v}x`}</option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-c-dim">Background:</span>
                <div className="flex items-center gap-1">
                  <input
                    type="color"
                    value={bgColor.startsWith('#') && bgColor.length <= 7 ? bgColor : '#000000'}
                    onChange={(e) => { setBgColor(e.target.value); saveProject({ bgColor: e.target.value }); }}
                    className="w-5 h-5 rounded cursor-pointer border border-c-border bg-transparent p-0 overflow-hidden shrink-0"
                    title="Choose custom color"
                  />
                  <select
                    value={bgColor}
                    onChange={(e) => { setBgColor(e.target.value); saveProject({ bgColor: e.target.value }); }}
                    className="input text-xs py-1 pr-7"
                  >
                    <option value="black">Black</option>
                    <option value="white">White</option>
                    <option value="#1e1e2e">Catppuccin Crust</option>
                    <option value="#0f172a">Slate</option>
                    <option value="#1c1917">Stone</option>
                    <option value="#022c22">Emerald</option>
                    <option value="#1e1b4b">Indigo</option>
                    {bgColor !== 'black' && bgColor !== 'white' && !['#1e1e2e', '#0f172a', '#1c1917', '#022c22', '#1e1b4b'].includes(bgColor) && (
                      <option value={bgColor}>Custom ({bgColor})</option>
                    )}
                  </select>
                </div>
              </div>
              <button onClick={randomizeMotion} disabled={randomEffects.size === 0} className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-50">
                <RefreshCw className="w-3 h-3" /> {t('storyboard.randomize')}
              </button>
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-c-dim">{t('storyboard.motionAll')}:</span>
                <select onChange={(e) => setAllMotion(e.target.value as MotionEffect)} className="input text-[10px] py-0.5" defaultValue="">
                  <option value="" disabled>—</option>
                  {allEffects.map((fx) => (
                    <option key={fx} value={fx}>{t(`storyboard.motion${fx.split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('')}` as never)}</option>
                  ))}
                </select>
              </div>
              <button onClick={handleAssemble} disabled={assembling || !segments.length} className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50 ml-auto">
                <Film className="w-3.5 h-3.5" />
                {result ? t('storyboard.reAssemble') : t('storyboard.assemble')}
              </button>
            </div>
          </div>

          <div className="space-y-1.5 max-h-[400px] overflow-auto">
            {segments.map((seg, i) => (
              <div key={i} className="flex items-center gap-2 border border-c-border rounded-lg bg-c-surface p-1.5">
                {(() => {
                  const segIsVid = seg.mediaType === 'video' || /\.(mp4|webm|mov)$/i.test(seg.videoFilename || seg.imageFilename || '');
                  const vidSrc = seg.videoUrl || (segIsVid ? seg.imageUrl : '');
                  return (
                    <div className="w-14 h-10 shrink-0 rounded overflow-hidden relative cursor-pointer group" onClick={() => !segIsVid && setLightboxUrl(seg.imageUrl)}>
                      {segIsVid && vidSrc ? (
                        <video src={`${vidSrc}#t=0.1`} className="w-full h-full object-cover" muted preload="metadata" />
                      ) : (
                        <img src={seg.imageUrl} alt={seg.text || `Segment ${i + 1}`} className="w-full h-full object-cover" />
                      )}
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors" />
                      <div className="absolute top-0 left-0 bg-black/60 rounded-br px-1 text-[8px] font-mono text-white">{i + 1}</div>
                      {segIsVid && <div className="absolute bottom-0 right-0 bg-violet-600/80 rounded-tl px-1 text-[7px] text-white">VID</div>}
                    </div>
                  );
                })()}
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] text-c-text truncate">{seg.text || '—'}</div>
                  <div className="text-[9px] text-c-dim">{seg.startTime.toFixed(1)}s &rarr; {seg.endTime.toFixed(1)}s</div>
                </div>
                {(seg.mediaType === 'video' || /\.(mp4|webm|mov)$/i.test(seg.videoFilename || seg.imageFilename || '')) ? (
                  <span className="text-[10px] text-violet-400 flex items-center gap-1"><Video className="w-3 h-3" /></span>
                ) : (
                  <select value={seg.motion || 'static'} onChange={(e) => updateSegmentMotion(i, e.target.value as MotionEffect)} className="input text-[10px] py-0.5 w-24">
                    <option value="static">{t('storyboard.motionStatic')}</option>
                    <option value="zoom-in">{t('storyboard.motionZoomIn')}</option>
                    <option value="zoom-out">{t('storyboard.motionZoomOut')}</option>
                    <option value="pan-left">{t('storyboard.motionPanLeft')}</option>
                    <option value="pan-right">{t('storyboard.motionPanRight')}</option>
                    <option value="pan-up">{t('storyboard.motionPanUp')}</option>
                    <option value="pan-down">{t('storyboard.motionPanDown')}</option>
                  </select>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {assembling && (
        <div className="border border-cyan-800/30 rounded-xl p-4 bg-cyan-900/10 space-y-3">
          <div className="flex items-center gap-2">
            <Spinner size="sm" />
            <span className="text-xs text-cyan-300 font-medium">{t('storyboard.assembling')}</span>
            {assembleStep && <span className="text-[10px] text-cyan-400/70 ml-auto capitalize">{assembleStep}</span>}
            <button onClick={() => assembleAbortRef.current?.abort()} className="ml-auto btn-secondary text-xs py-1 px-2.5 flex items-center gap-1 text-red-400 hover:text-red-300 border-red-500/30 hover:border-red-500/50">
              <Square className="w-3 h-3" /> {t('storyboard.stopAssemble')}
            </button>
          </div>
          {assembleClipProgress.total > 0 && (
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-c-dim">
                <span>{t('storyboard.encodingClip', { current: assembleClipProgress.current, total: assembleClipProgress.total })}</span>
                <span>{Math.round((assembleClipProgress.current / assembleClipProgress.total) * 100)}%</span>
              </div>
              <div className="w-full bg-cyan-900/30 rounded-full h-1.5 overflow-hidden">
                <div className="h-full bg-cyan-400 rounded-full transition-all duration-300" style={{ width: `${(assembleClipProgress.current / assembleClipProgress.total) * 100}%` }} />
              </div>
            </div>
          )}
          <div ref={assembleLogRef} className="font-mono text-[10px] text-c-dim space-y-0.5 max-h-[160px] overflow-auto">
            {assembleProgress.map((line, i) => (
              <div key={i} className={i === assembleProgress.length - 1 ? 'text-cyan-300' : ''}>{line}</div>
            ))}
          </div>
        </div>
      )}

      {result && !assembling && (
        <div className="space-y-4">
          <div className="border border-green-800/30 rounded-xl p-3 bg-green-900/10 flex items-center gap-3">
            <CheckCircle className="w-5 h-5 text-green-400 shrink-0" />
            <div className="flex-1">
              <div className="text-sm font-medium text-c-text">{t('storyboard.done')}</div>
              <div className="text-xs text-c-dim">{result.sizeKB > 0 ? `${result.sizeKB} KB | ` : ''}{result.duration > 0 ? `${result.duration.toFixed(1)}s` : ''}</div>
            </div>
            <a href={result.url} download={`${(metadataTitle || scriptTopic || projectName || 'video').replace(/[<>:"/\\|?*]+/g, '').replace(/\s+/g, '_')}.mp4`} className="btn-primary text-xs flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" /> {t('common.download')}
            </a>
          </div>
          <div className="rounded-xl overflow-hidden border border-c-border bg-black">
            <video ref={videoRef} src={result.url} controls className="w-full max-h-[500px]" />
          </div>
          {metadataTitle && (
            <div className="border border-c-border rounded-xl overflow-hidden bg-c-surface">
              <div className="px-4 py-2 border-b border-c-border bg-c-bg flex items-center justify-between">
                <span className="text-xs font-medium text-c-text flex items-center gap-1.5">
                  <Tag className="w-3.5 h-3.5 text-orange-400" /> {t('storyboard.stepMetadata')}
                </span>
                <button onClick={() => navigator.clipboard.writeText(`${metadataTitle}\n\n${metadataDesc}\n\n${metadataTags.join(', ')}`)} className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1">
                  <Copy className="w-3 h-3" /> {t('storyboard.copyAll')}
                </button>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-c-dim uppercase">{t('storyboard.metadataTitle')}</span>
                    <button onClick={() => navigator.clipboard.writeText(metadataTitle)} className="p-1 -m-1 text-c-dim hover:text-cyan-400"><Copy className="w-3.5 h-3.5" /></button>
                  </div>
                  <div className="text-sm font-medium text-c-text">{metadataTitle}</div>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-c-dim uppercase">{t('storyboard.metadataDescription')}</span>
                    <button onClick={() => navigator.clipboard.writeText(metadataDesc)} className="p-1 -m-1 text-c-dim hover:text-cyan-400"><Copy className="w-3.5 h-3.5" /></button>
                  </div>
                  <div className="text-[11px] text-c-muted whitespace-pre-wrap leading-relaxed">{metadataDesc}</div>
                </div>
                {metadataTags.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-c-dim uppercase">{t('storyboard.metadataTags')}</span>
                      <button onClick={() => navigator.clipboard.writeText(metadataTags.join(', '))} className="p-1 -m-1 text-c-dim hover:text-cyan-400"><Copy className="w-3.5 h-3.5" /></button>
                    </div>
                    <div className="flex flex-wrap gap-1 cursor-pointer group/tags" onClick={() => navigator.clipboard.writeText(metadataTags.join(', '))} title="Click to copy all tags">
                      {metadataTags.map((tag, i) => (
                        <span key={i} className="text-[9px] bg-cyan-900/30 text-cyan-300/80 px-2 py-0.5 rounded-full group-hover/tags:bg-cyan-800/40 group-hover/tags:text-cyan-200 transition-colors">{tag}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="border border-c-border rounded-xl overflow-hidden bg-c-surface">
            <div className="px-4 py-2 border-b border-c-border bg-c-bg">
              <span className="text-xs font-medium text-c-text flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-emerald-400" /> {t('storyboard.projectSummary')}
              </span>
            </div>
            <div className="p-4 space-y-3">
              {scriptTopic && (
                <div>
                  <span className="text-[10px] text-c-dim uppercase block mb-0.5">{t('storyboard.selectedTopic')}</span>
                  <div className="text-xs text-c-text">{scriptTopic}</div>
                </div>
              )}
              <div className="flex flex-wrap gap-4">
                {audioFile && (
                  <div>
                    <span className="text-[10px] text-c-dim uppercase block mb-0.5">{t('storyboard.stepAudio')}</span>
                    <div className="text-xs text-c-text flex items-center gap-1"><Mic className="w-3 h-3 text-amber-400" /> {audioFile.duration.toFixed(1)}s — {voice}</div>
                  </div>
                )}
                <div>
                  <span className="text-[10px] text-c-dim uppercase block mb-0.5">{t('storyboard.stepImages')}</span>
                  <div className="text-xs text-c-text flex items-center gap-1"><Image className="w-3 h-3 text-cyan-400" /> {generatedImages.filter(i => i.status === 'done').length} {t('storyboard.images')}</div>
                </div>
                <div>
                  <span className="text-[10px] text-c-dim uppercase block mb-0.5">{t('storyboard.stepTimeline')}</span>
                  <div className="text-xs text-c-text flex items-center gap-1"><Clock className="w-3 h-3 text-rose-400" /> {segments.length} {t('storyboard.segments')}</div>
                </div>
              </div>
              {scriptText && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-c-dim uppercase">{t('storyboard.stepScript')}</span>
                    <button onClick={() => navigator.clipboard.writeText(scriptText)} className="p-1 -m-1 text-c-dim hover:text-cyan-400"><Copy className="w-3.5 h-3.5" /></button>
                  </div>
                  <div className="text-[11px] text-c-muted whitespace-pre-wrap leading-relaxed max-h-[150px] overflow-auto">{scriptText}</div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
