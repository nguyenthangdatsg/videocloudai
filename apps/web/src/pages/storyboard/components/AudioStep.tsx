import { useState } from 'react';
import { Mic, Globe, Play, Pause, CheckCircle, ArrowRight, Merge, RefreshCw, Scissors, Trash2 } from 'lucide-react';
import clsx from 'clsx';
import { Spinner } from '../../../components/ui/Spinner';
import { AdvancedToggle } from './AdvancedToggle';
import { useStoryboard } from '../StoryboardContext';
import type { VoiceInfo } from '../../../lib/api';

export function AudioStep() {
  const {
    voices, voice, setVoice, langFilter, setLangFilter,
    ttsRate, setTtsRate, ttsPitch, setTtsPitch, ttsVolume, setTtsVolume, ttsStyle, setTtsStyle,
    voicePreviewLoading, voicePreviewPlaying, handleVoicePreview,
    generatingAudio, audioProgress, handleGenerateAudio,
    audioFile, handleClearAudio, transcriptEntries, setTranscriptEntries,
    handleSplitEntry,
    handleMergeEntry,
    handleSplitAtCursor,
    handleUpdateEntryText,
    handleAutoSeparate, handleRetranscribe,
    scriptText, setStep, saveProject,
    audioLogRef,
    t,
  } = useStoryboard();
  const [separateSec, setSeparateSec] = useState(3);

  const allVoices = voices?.voices ?? {};
  const allLanguages = voices?.languages ?? {};
  const currentVoice: VoiceInfo | undefined = allVoices[voice];
  const availableStyles = currentVoice?.styles ?? [];

  const langList = Object.values(allVoices).reduce<Record<string, string>>((acc, v) => {
    if (!acc[v.lang]) acc[v.lang] = v.flag;
    return acc;
  }, {});

  const filtered = Object.entries(allVoices).filter(([, info]) =>
    langFilter === 'all' || info.lang === langFilter,
  );
  const grouped: Record<string, [string, VoiceInfo][]> = {};
  for (const entry of filtered) {
    const lang = entry[1].lang;
    if (!grouped[lang]) grouped[lang] = [];
    grouped[lang].push(entry);
  }

  return (
    <div className="space-y-3">
      {/* Voice selection — compact row */}
      <div className="flex items-end gap-3 flex-wrap">
        <div className="min-w-[120px]">
          <label className="text-[10px] text-c-dim mb-0.5 block flex items-center gap-1">
            <Globe className="w-3 h-3" /> {t('tts.selectLanguage')}
          </label>
          <select value={langFilter} onChange={(e) => setLangFilter(e.target.value)} className="input text-sm w-full">
            <option value="all">{t('tts.allLanguages')}</option>
            {Object.entries(langList).map(([code, flag]) => (
              <option key={code} value={code}>{flag} {allLanguages[code] ?? code}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="text-[10px] text-c-dim mb-0.5 block flex items-center gap-1">
            <Mic className="w-3 h-3" /> {t('tts.searchVoices')}
          </label>
          <div className="flex gap-2">
            <select
              value={voice}
              onChange={(e) => { setVoice(e.target.value); setTtsStyle(''); }}
              className="input text-sm flex-1"
            >
              {Object.entries(grouped).map(([lang, entries]) => (
                <optgroup key={lang} label={`${entries[0]?.[1]?.flag ?? ''} ${allLanguages[lang] ?? lang}`}>
                  {entries.map(([id, info]) => (
                    <option key={id} value={id}>
                      {info.flag} {info.label} ({info.gender === 'male' ? '\u2642' : '\u2640'})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <button
              onClick={handleVoicePreview}
              disabled={voicePreviewLoading}
              className={clsx(
                'shrink-0 w-9 h-9 rounded-lg border flex items-center justify-center transition-all',
                voicePreviewPlaying ? 'bg-cyan-500/20 border-cyan-500/50 text-cyan-300' : 'border-c-border text-c-muted hover:text-cyan-300 hover:border-cyan-500/50',
                voicePreviewLoading && 'opacity-50 cursor-wait',
              )}
              title={t('tts.previewVoice')}
            >
              {voicePreviewLoading ? <Spinner size="sm" /> : voicePreviewPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <button
          onClick={handleGenerateAudio}
          disabled={!scriptText.trim() || generatingAudio}
          className="btn-primary text-xs flex items-center gap-1.5 disabled:opacity-50 py-2 px-4"
        >
          {generatingAudio ? <Spinner size="sm" /> : <Mic className="w-3.5 h-3.5" />}
          {t('storyboard.generateAudio')}
        </button>
      </div>

      {/* Advanced: Voice tuning controls */}
      <AdvancedToggle label={t('tts.voiceControls')}>
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: t('tts.speed'), value: ttsRate, set: setTtsRate, min: -50, max: 100, unit: '%' },
              { label: t('tts.pitch'), value: ttsPitch, set: setTtsPitch, min: -50, max: 50, unit: 'Hz' },
              { label: t('tts.volume'), value: ttsVolume, set: setTtsVolume, min: -50, max: 100, unit: '%' },
            ].map(({ label, value, set, min, max, unit }) => (
              <div key={label}>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs text-c-muted">{label}</label>
                  <span className="text-xs text-cyan-300 font-mono">{value}{unit}</span>
                </div>
                <input type="range" min={min} max={max} step={5} value={value}
                  onChange={(e) => set(Number(e.target.value))}
                  className="w-full accent-cyan-500 h-1.5" />
              </div>
            ))}
          </div>
          {availableStyles.length > 0 && (
            <div>
              <label className="text-xs text-c-muted mb-1.5 block">{t('tts.emotion')}</label>
              <div className="flex flex-wrap gap-1.5">
                <button
                  onClick={() => setTtsStyle('')}
                  className={clsx('text-xs px-2.5 py-1 rounded-lg border transition-colors',
                    !ttsStyle ? 'bg-cyan-900/30 border-cyan-600/50 text-cyan-300' : 'border-c-border text-c-muted hover:border-c-border-hi')}
                >{t('tts.neutral')}</button>
                {availableStyles.map((s) => (
                  <button key={s} onClick={() => setTtsStyle(s)}
                    className={clsx('text-xs px-2.5 py-1 rounded-lg border transition-colors capitalize',
                      ttsStyle === s ? 'bg-amber-900/30 border-amber-600/50 text-amber-300' : 'border-c-border text-c-muted hover:border-c-border-hi')}
                  >{s}</button>
                ))}
              </div>
            </div>
          )}
          <button onClick={() => { setTtsRate(0); setTtsPitch(0); setTtsVolume(0); setTtsStyle(''); }} className="text-[10px] text-c-dim hover:text-c-muted">
            {t('tts.resetParams')}
          </button>
        </div>
      </AdvancedToggle>

      {/* Progress */}
      {audioProgress.length > 0 && (
        <div className="border border-cyan-800/30 rounded-lg p-2.5 bg-cyan-900/10">
          <div className="flex items-center gap-2 mb-1">
            {generatingAudio ? <Spinner size="sm" /> : <CheckCircle className="w-3.5 h-3.5 text-green-400" />}
            <span className="text-xs text-cyan-300">{generatingAudio ? t('storyboard.generatingAudio') : t('storyboard.audioDone')}</span>
          </div>
          <div ref={audioLogRef} className="font-mono text-[10px] text-c-dim space-y-0.5 max-h-[100px] overflow-auto">
            {audioProgress.map((line, i) => <div key={i}>{line}</div>)}
          </div>
        </div>
      )}

      {/* Audio result */}
      {audioFile && (
        <div className="border border-green-800/30 bg-green-900/10 rounded-lg p-2.5 space-y-2">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-400" />
            <span className="text-xs font-medium text-c-text">{audioFile.filename}</span>
            <span className="text-[10px] text-c-dim">{audioFile.duration.toFixed(1)}s</span>
            <button onClick={handleClearAudio} className="ml-auto text-[10px] text-red-400 hover:text-red-300 flex items-center gap-1" title={t('storyboard.clearAudio')}>
              <Trash2 className="w-3 h-3" /> {t('storyboard.clearAudio')}
            </button>
          </div>
          <audio src={audioFile.url} controls className="w-full h-8" />
        </div>
      )}

      {/* Transcript segments */}
      {transcriptEntries.length > 0 && (
        <div className="border border-c-border rounded-lg overflow-hidden">
          <div className="px-3 py-2 border-b border-c-border bg-c-surface flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-c-text shrink-0">{transcriptEntries.length} {t('storyboard.segments')}</span>
            <div className="flex items-center gap-2">
              <button onClick={handleRetranscribe} className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-1" title={t('storyboard.retranscribeHint')}>
                <RefreshCw className="w-3 h-3" /> {t('storyboard.retranscribe')}
              </button>
              <div className="flex items-center gap-0 border border-cyan-500/30 rounded-lg h-7 overflow-hidden">
                <button onClick={() => handleAutoSeparate(separateSec)} className="text-cyan-400 hover:bg-cyan-500/10 text-[10px] px-2 h-full font-medium transition-colors flex items-center gap-1" title={`Split segments longer than ${separateSec}s`}>
                  <Scissors className="w-3 h-3" /> Split &gt; {separateSec}s
                </button>
                <select value={separateSec} onChange={(e) => setSeparateSec(Number(e.target.value))} className="text-[10px] bg-transparent text-cyan-400 border-l border-cyan-500/30 h-full px-1 cursor-pointer outline-none">
                  {Array.from({ length: 18 }, (_, i) => i + 3).map(s => (
                    <option key={s} value={s}>{s}s</option>
                  ))}
                </select>
              </div>
              <button onClick={() => { setStep('prompts'); saveProject({ currentStep: 'prompts' }); }} className="btn-primary text-xs flex items-center gap-1 h-7 px-3">
                {t('storyboard.generatePrompts')} <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
          <div className="max-h-[200px] overflow-auto divide-y divide-c-border">
            {transcriptEntries.map((e, idx) => {
              const dur = (e.endMs - e.startMs) / 1000;
              const isShort = dur < separateSec;
              return (
                <div key={`${e.startMs}-${e.endMs}-${idx}`} className={clsx('px-3 py-1.5 flex gap-2 items-center hover:bg-c-surface/30 transition-colors', isShort ? 'bg-orange-900/15' : '')}>
                  <span className="text-[10px] font-mono text-cyan-300/70 shrink-0 w-28 flex items-center gap-1.5">
                    {e.startTime.split(',')[0]} &rarr; {e.endTime.split(',')[0]}
                    <span className={clsx('text-[9px] font-bold', isShort ? 'text-orange-400' : 'text-c-dim')}>({dur.toFixed(1)}s)</span>
                  </span>
                  <input
                    type="text"
                    defaultValue={e.text}
                    onBlur={(ev) => { const val = ev.target.value.trim(); if (val && val !== e.text) handleUpdateEntryText(e.index, val); }}
                    onKeyDown={(ev) => {
                      const pos = ev.currentTarget.selectionStart ?? 0;
                      const len = ev.currentTarget.value.length;
                      if (ev.key === 'Enter') { ev.preventDefault(); if (pos > 0 && pos < len) handleSplitAtCursor(e.index, pos, ev.currentTarget.value); }
                      if (ev.key === 'Backspace' && pos === 0 && ev.currentTarget.selectionEnd === 0 && idx > 0) { ev.preventDefault(); handleMergeEntry(e.index, 'prev'); }
                    }}
                    className="flex-1 text-xs text-c-muted bg-transparent border-none outline-none focus:text-c-text px-1 py-0.5 rounded hover:bg-c-elevated/50 focus:bg-c-elevated transition-colors"
                  />
                  <div className="shrink-0 flex items-center gap-0.5">
                    {idx > 0 && (
                      <button onClick={() => handleMergeEntry(e.index, 'prev')} className="p-1 rounded text-c-dim hover:text-amber-400 hover:bg-amber-900/20 transition-colors" title={t('storyboard.mergeWithPrev')}>
                        <Merge className="w-3 h-3 -rotate-90" />
                      </button>
                    )}
                    {idx < transcriptEntries.length - 1 && (
                      <button onClick={() => handleMergeEntry(e.index, 'next')} className="p-1 rounded text-c-dim hover:text-amber-400 hover:bg-amber-900/20 transition-colors" title={t('storyboard.mergeWithNext')}>
                        <Merge className="w-3 h-3 rotate-90" />
                      </button>
                    )}
                    {dur > 3.0 && (
                      <select
                        onChange={(evt) => { const val = parseInt(evt.target.value); if (val) handleSplitEntry(e.index, val); evt.target.value = ''; }}
                        className="input text-[10px] py-0.5 px-1 bg-c-bg border-c-border h-6 pr-6"
                        defaultValue=""
                      >
                        <option value="" disabled>{t('storyboard.splitOption')}</option>
                        {[3, 4, 5, 6, 7].map((s) => (
                          <option key={s} value={s}>{t('storyboard.splitLimit', { s })}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
