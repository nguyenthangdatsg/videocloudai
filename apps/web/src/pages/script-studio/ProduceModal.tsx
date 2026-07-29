import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { X, Play, Monitor, Smartphone, Subtitles, Zap, Eye, SkipForward } from 'lucide-react';
import { ttsApi } from '../../lib/api';

interface ProduceOptions {
  voice: string;
  orientation: 'landscape' | 'portrait';
  subtitles: boolean;
  autoRender: boolean;
  reviewMode: 'auto' | 'review';
  fromStage?: 'alignment' | 'clips' | 'timeline' | 'render';
}

export function ProduceModal({ onSubmit, onClose, submitting, fromStage }: {
  onSubmit: (options: ProduceOptions) => void;
  onClose: () => void;
  submitting: boolean;
  fromStage?: 'alignment' | 'clips' | 'timeline' | 'render';
}) {
  const { t } = useTranslation();
  const [voice, setVoice] = useState('');
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>('portrait');
  const [subtitles, setSubtitles] = useState(true);
  const [autoRender, setAutoRender] = useState(true);
  const [reviewMode, setReviewMode] = useState<'auto' | 'review'>('auto');

  const { data: voiceData } = useQuery({
    queryKey: ['tts-voices'],
    queryFn: ttsApi.voices,
  });

  const voices = voiceData?.voices ?? {};
  const voiceEntries = Object.entries(voices).sort((a, b) => a[0].localeCompare(b[0]));

  const isRerun = !!fromStage;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 animate-fade-in" onClick={onClose}>
      <div className="card p-6 w-full max-w-md mx-4 space-y-5 animate-slide-up" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex justify-between items-center">
          <h3 className="text-lg font-semibold text-c-text flex items-center gap-2">
            {isRerun ? <SkipForward className="w-5 h-5 text-c-accent" /> : <Play className="w-5 h-5 text-c-accent" />}
            {isRerun
              ? t('scriptStudio.produce.rerunTitle', { stage: t(`scriptStudio.produce.fromStage.${fromStage}`) })
              : t('scriptStudio.produce.modalTitle')}
          </h3>
          <button onClick={onClose} className="text-c-dim hover:text-c-text p-1.5 rounded-lg hover:bg-c-elevated transition-colors cursor-pointer">
            <X className="w-5 h-5" />
          </button>
        </div>

        {isRerun && (
          <div className="text-xs text-c-muted bg-c-elevated rounded-lg p-3">
            {t('scriptStudio.produce.rerunHint', { stage: t(`scriptStudio.produce.fromStage.${fromStage}`) })}
          </div>
        )}

        {/* Voice — only shown for full runs or re-runs from alignment */}
        {(!isRerun || fromStage === 'alignment') && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-c-text">{t('scriptStudio.produce.voice')}</label>
            <select
              className="input w-full text-sm"
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
            >
              <option value="">{t('scriptStudio.produce.voiceDefault')}</option>
              {voiceEntries.map(([shortName, v]) => (
                <option key={shortName} value={shortName}>
                  {(v as any).flag} {(v as any).label} ({(v as any).lang})
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Orientation */}
        {(!isRerun || fromStage === 'alignment') && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-c-text">{t('scriptStudio.produce.orientation')}</label>
            <div className="flex gap-2">
              {([
                { value: 'landscape' as const, icon: Monitor, label: t('scriptStudio.produce.landscape') },
                { value: 'portrait' as const, icon: Smartphone, label: t('scriptStudio.produce.portrait') },
              ]).map(({ value, icon: Icon, label }) => (
                <button
                  key={value}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${
                    orientation === value
                      ? 'border-c-accent bg-c-accent/10 text-c-accent'
                      : 'border-c-border bg-c-surface text-c-muted hover:text-c-text hover:border-c-dim'
                  }`}
                  onClick={() => setOrientation(value)}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Review mode toggle (not shown for re-runs) */}
        {!isRerun && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-c-text">{t('scriptStudio.produce.reviewMode')}</label>
            <div className="flex gap-2">
              {([
                { value: 'auto' as const, icon: Zap, label: t('scriptStudio.produce.modeAuto') },
                { value: 'review' as const, icon: Eye, label: t('scriptStudio.produce.modeReview') },
              ]).map(({ value, icon: Icon, label }) => (
                <button
                  key={value}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors cursor-pointer ${
                    reviewMode === value
                      ? 'border-c-accent bg-c-accent/10 text-c-accent'
                      : 'border-c-border bg-c-surface text-c-muted hover:text-c-text hover:border-c-dim'
                  }`}
                  onClick={() => setReviewMode(value)}
                >
                  <Icon className="w-4 h-4" />
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-c-dim">
              {reviewMode === 'review'
                ? t('scriptStudio.produce.modeReviewHint')
                : t('scriptStudio.produce.modeAutoHint')}
            </p>
          </div>
        )}

        {/* Toggles */}
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer group">
            <input
              type="checkbox"
              className="w-4 h-4 rounded border-c-border accent-c-accent cursor-pointer"
              checked={subtitles}
              onChange={(e) => setSubtitles(e.target.checked)}
            />
            <div className="flex-1">
              <div className="flex items-center gap-1.5 text-sm font-medium text-c-text group-hover:text-c-accent transition-colors">
                <Subtitles className="w-4 h-4" />
                {t('scriptStudio.produce.subtitles')}
              </div>
              <p className="text-xs text-c-dim mt-0.5">{t('scriptStudio.produce.subtitlesHint')}</p>
            </div>
          </label>

          {(!isRerun || fromStage === 'alignment') && (
            <label className="flex items-center gap-3 cursor-pointer group">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-c-border accent-c-accent cursor-pointer"
                checked={autoRender}
                onChange={(e) => setAutoRender(e.target.checked)}
              />
              <div className="flex-1">
                <div className="flex items-center gap-1.5 text-sm font-medium text-c-text group-hover:text-c-accent transition-colors">
                  <Zap className="w-4 h-4" />
                  {t('scriptStudio.produce.autoRender')}
                </div>
                <p className="text-xs text-c-dim mt-0.5">{t('scriptStudio.produce.autoRenderHint')}</p>
              </div>
            </label>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-2">
          <button className="btn-secondary flex-1 text-sm cursor-pointer" onClick={onClose}>
            {t('scriptStudio.produce.cancel')}
          </button>
          <button
            className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm cursor-pointer"
            onClick={() => onSubmit({ voice, orientation, subtitles, autoRender, reviewMode, fromStage })}
            disabled={submitting}
          >
            {isRerun ? <SkipForward className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {submitting ? t('scriptStudio.produce.starting') : (isRerun ? t('scriptStudio.produce.startRerun') : t('scriptStudio.produce.start'))}
          </button>
        </div>
      </div>
    </div>
  );
}
