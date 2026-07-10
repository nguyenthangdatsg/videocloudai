import { useState } from 'react';
import clsx from 'clsx';
import {
  Type,
  ChevronDown,
  ChevronUp,
  AlignLeft,
  AlignCenter,
  AlignRight,
  ArrowUp,
  Minus as ArrowHorizontal,
  ArrowDown,
  Eye,
  EyeOff,
} from 'lucide-react';
import type { SubtitleStyle } from '../../../lib/api';

const FONT_FAMILIES = [
  'Arial',
  'Arial Black',
  'Helvetica',
  'Impact',
  'Georgia',
  'Times New Roman',
  'Courier New',
  'Verdana',
  'Trebuchet MS',
  'Comic Sans MS',
  'Futura',
  'Bebas Neue',
  'Oswald',
  'Montserrat',
  'Roboto',
  'Poppins',
  'Inter',
  'Lato',
  'Open Sans',
];

const FONT_SIZES = [24, 28, 32, 36, 40, 44, 48, 56, 64, 72, 80, 96];

const PRESET_STYLES: Array<{ label: string; labelVi: string; style: Partial<SubtitleStyle> }> = [
  {
    label: 'Classic White',
    labelVi: 'Trắng cổ điển',
    style: { fontFamily: 'Arial', fontSize: 48, fontColor: '#FFFFFF', fontWeight: 'bold', strokeColor: '#000000', strokeWidth: 2, bgColor: '#000000', bgOpacity: 0, position: 'bottom', uppercase: false, animation: 'none' },
  },
  {
    label: 'Yellow Pop',
    labelVi: 'Vàng nổi bật',
    style: { fontFamily: 'Impact', fontSize: 56, fontColor: '#FFD700', fontWeight: 'bold', strokeColor: '#000000', strokeWidth: 3, bgColor: '#000000', bgOpacity: 0, position: 'bottom', uppercase: true, animation: 'none' },
  },
  {
    label: 'Netflix Style',
    labelVi: 'Kiểu Netflix',
    style: { fontFamily: 'Arial', fontSize: 44, fontColor: '#FFFFFF', fontWeight: 'bold', strokeColor: '#000000', strokeWidth: 0, bgColor: '#000000', bgOpacity: 0.75, position: 'bottom', uppercase: false, animation: 'none' },
  },
  {
    label: 'TikTok Bold',
    labelVi: 'TikTok đậm',
    style: { fontFamily: 'Arial Black', fontSize: 52, fontColor: '#FFFFFF', fontWeight: 'bold', strokeColor: '#FF0050', strokeWidth: 3, bgColor: '#000000', bgOpacity: 0, position: 'center', uppercase: true, animation: 'word-highlight' },
  },
  {
    label: 'Minimal Dark',
    labelVi: 'Tối giản',
    style: { fontFamily: 'Helvetica', fontSize: 36, fontColor: '#E0E0E0', fontWeight: 'normal', strokeColor: '#000000', strokeWidth: 1, bgColor: '#1a1a2e', bgOpacity: 0.6, position: 'bottom', uppercase: false, animation: 'fade' },
  },
  {
    label: 'Karaoke Glow',
    labelVi: 'Karaoke phát sáng',
    style: { fontFamily: 'Arial Black', fontSize: 48, fontColor: '#00FF88', fontWeight: 'bold', strokeColor: '#003322', strokeWidth: 2, bgColor: '#000000', bgOpacity: 0, position: 'bottom', uppercase: false, animation: 'karaoke' },
  },
  {
    label: 'Cinematic',
    labelVi: 'Điện ảnh',
    style: { fontFamily: 'Georgia', fontSize: 40, fontColor: '#F5F5DC', fontWeight: 'normal', strokeColor: '#000000', strokeWidth: 1, bgColor: '#000000', bgOpacity: 0, position: 'bottom', uppercase: false, animation: 'fade' },
  },
  {
    label: 'News Ticker',
    labelVi: 'Tin tức',
    style: { fontFamily: 'Roboto', fontSize: 36, fontColor: '#FFFFFF', fontWeight: 'bold', strokeColor: '#000000', strokeWidth: 0, bgColor: '#CC0000', bgOpacity: 0.85, position: 'bottom', uppercase: true, animation: 'none' },
  },
];

interface SubtitlePanelProps {
  subtitleStyle: SubtitleStyle;
  setSubtitleStyle: React.Dispatch<React.SetStateAction<SubtitleStyle>>;
  saveProject: (updates: Record<string, unknown>) => void;
  t: (key: string, vars?: Record<string, unknown>) => string;
  sampleText?: string;
}

export function SubtitlePanel({ subtitleStyle, setSubtitleStyle, saveProject, t, sampleText }: SubtitlePanelProps) {
  const [expanded, setExpanded] = useState(false);

  const update = (partial: Partial<SubtitleStyle>) => {
    setSubtitleStyle(prev => {
      const next = { ...prev, ...partial };
      saveProject({ subtitleStyle: next });
      return next;
    });
  };

  const previewText = sampleText || 'The quick brown fox jumps over the lazy dog';
  const displayText = subtitleStyle.uppercase ? previewText.toUpperCase() : previewText;

  return (
    <div className="border-t border-c-border pt-3 space-y-2">
      {/* Header row */}
      <div className="flex items-center gap-2">
        <Type className="w-3.5 h-3.5 text-c-dim shrink-0" />
        <span className="text-[10px] text-c-dim font-medium shrink-0">{t('storyboard.subtitles')}:</span>

        {/* Enable/disable toggle */}
        <button
          onClick={() => update({ enabled: !subtitleStyle.enabled })}
          className={clsx(
            'flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full border transition-colors',
            subtitleStyle.enabled
              ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-300'
              : 'border-c-border bg-c-bg text-c-dim'
          )}
        >
          {subtitleStyle.enabled ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
          {subtitleStyle.enabled ? t('storyboard.subtitleOn') : t('storyboard.subtitleOff')}
        </button>

        <div className="flex-1" />

        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[10px] text-cyan-400 hover:text-cyan-300 flex items-center gap-0.5"
        >
          {expanded ? t('storyboard.subtitleCollapse') : t('storyboard.subtitleExpand')}
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {subtitleStyle.enabled && expanded && (
        <div className="space-y-3 bg-c-bg rounded-lg border border-c-border p-3">
          {/* Presets row */}
          <div className="space-y-1">
            <span className="text-[9px] text-c-dim uppercase font-medium">{t('storyboard.subtitlePresets')}</span>
            <div className="flex flex-wrap gap-1">
              {PRESET_STYLES.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => update(preset.style)}
                  className="text-[9px] px-2 py-1 rounded border border-c-border bg-c-surface hover:border-cyan-500/50 hover:bg-cyan-500/5 text-c-muted hover:text-c-text transition-colors"
                >
                  {t('storyboard.subtitlePreset_' + preset.label.replace(/\s+/g, ''))}
                </button>
              ))}
            </div>
          </div>

          {/* Font controls row */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-c-dim">{t('storyboard.subtitleFont')}:</span>
              <select
                value={subtitleStyle.fontFamily}
                onChange={(e) => update({ fontFamily: e.target.value })}
                className="input text-[10px] py-0.5 w-32"
              >
                {FONT_FAMILIES.map(f => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-c-dim">{t('storyboard.subtitleSize')}:</span>
              <select
                value={subtitleStyle.fontSize}
                onChange={(e) => update({ fontSize: parseInt(e.target.value) })}
                className="input text-[10px] py-0.5 w-16"
              >
                {FONT_SIZES.map(s => <option key={s} value={s}>{s}px</option>)}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-c-dim">{t('storyboard.subtitleWeight')}:</span>
              <select
                value={subtitleStyle.fontWeight}
                onChange={(e) => update({ fontWeight: e.target.value as 'normal' | 'bold' })}
                className="input text-[10px] py-0.5 w-20"
              >
                <option value="normal">{t('storyboard.subtitleWeightNormal')}</option>
                <option value="bold">{t('storyboard.subtitleWeightBold')}</option>
              </select>
            </div>
            <label className="flex items-center gap-1 cursor-pointer">
              <input
                type="checkbox"
                checked={subtitleStyle.uppercase}
                onChange={(e) => update({ uppercase: e.target.checked })}
                className="w-2.5 h-2.5 rounded accent-cyan-500"
              />
              <span className="text-[9px] text-c-dim">ABC</span>
            </label>
          </div>

          {/* Color controls row */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-c-dim">{t('storyboard.subtitleFontColor')}:</span>
              <input
                type="color"
                value={subtitleStyle.fontColor}
                onChange={(e) => update({ fontColor: e.target.value })}
                className="w-5 h-5 rounded cursor-pointer border border-c-border bg-transparent p-0 overflow-hidden shrink-0"
              />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-c-dim">{t('storyboard.subtitleStroke')}:</span>
              <input
                type="color"
                value={subtitleStyle.strokeColor}
                onChange={(e) => update({ strokeColor: e.target.value })}
                className="w-5 h-5 rounded cursor-pointer border border-c-border bg-transparent p-0 overflow-hidden shrink-0"
              />
              <input
                type="number"
                min={0} max={8} step={0.5}
                value={subtitleStyle.strokeWidth}
                onChange={(e) => update({ strokeWidth: parseFloat(e.target.value) || 0 })}
                className="input text-[10px] w-12 py-0.5 font-mono text-center"
              />
              <span className="text-[8px] text-c-dim">px</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-c-dim">{t('storyboard.subtitleBg')}:</span>
              <input
                type="color"
                value={subtitleStyle.bgColor}
                onChange={(e) => update({ bgColor: e.target.value })}
                className="w-5 h-5 rounded cursor-pointer border border-c-border bg-transparent p-0 overflow-hidden shrink-0"
              />
              <input
                type="range"
                min={0} max={1} step={0.05}
                value={subtitleStyle.bgOpacity}
                onChange={(e) => update({ bgOpacity: parseFloat(e.target.value) })}
                className="w-16 h-3 accent-cyan-500"
              />
              <span className="text-[8px] text-c-dim font-mono">{Math.round(subtitleStyle.bgOpacity * 100)}%</span>
            </div>
          </div>

          {/* Position & alignment row */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-c-dim">{t('storyboard.subtitlePosition')}:</span>
              <div className="flex rounded border border-c-border overflow-hidden">
                {(['top', 'center', 'bottom'] as const).map(pos => (
                  <button
                    key={pos}
                    onClick={() => update({ position: pos })}
                    className={clsx(
                      'w-7 h-6 flex items-center justify-center transition-colors',
                      subtitleStyle.position === pos ? 'bg-cyan-500/20 text-cyan-300' : 'bg-c-surface text-c-dim hover:text-c-text hover:bg-c-hover'
                    )}
                    title={t(`storyboard.subtitlePos_${pos}`)}
                  >
                    {pos === 'top' ? <ArrowUp className="w-3 h-3" /> : pos === 'center' ? <ArrowHorizontal className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-c-dim">{t('storyboard.subtitleAlign')}:</span>
              <div className="flex rounded border border-c-border overflow-hidden">
                {(['left', 'center', 'right'] as const).map(align => (
                  <button
                    key={align}
                    onClick={() => update({ alignment: align })}
                    className={clsx(
                      'w-7 h-6 flex items-center justify-center transition-colors',
                      subtitleStyle.alignment === align ? 'bg-cyan-500/20 text-cyan-300' : 'bg-c-surface text-c-dim hover:text-c-text hover:bg-c-hover'
                    )}
                    title={align}
                  >
                    {align === 'left' ? <AlignLeft className="w-3 h-3" /> : align === 'center' ? <AlignCenter className="w-3 h-3" /> : <AlignRight className="w-3 h-3" />}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-c-dim">{t('storyboard.subtitleMarginX')}:</span>
              <input
                type="number"
                min={0} max={200} step={10}
                value={subtitleStyle.marginX}
                onChange={(e) => update({ marginX: parseInt(e.target.value) || 0 })}
                className="input text-[10px] w-14 py-0.5 font-mono text-center"
              />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-c-dim">{t('storyboard.subtitleMarginBottom')}:</span>
              <input
                type="number"
                min={0} max={500} step={10}
                value={subtitleStyle.marginBottom}
                onChange={(e) => update({ marginBottom: parseInt(e.target.value) || 0 })}
                className="input text-[10px] w-14 py-0.5 font-mono text-center"
              />
            </div>
          </div>

          {/* Animation row */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1">
              <span className="text-[9px] text-c-dim">{t('storyboard.subtitleAnimation')}:</span>
              <select
                value={subtitleStyle.animation}
                onChange={(e) => update({ animation: e.target.value as SubtitleStyle['animation'] })}
                className="input text-[10px] py-0.5 w-32"
              >
                <option value="none">{t('storyboard.subtitleAnimNone')}</option>
                <option value="fade">{t('storyboard.subtitleAnimFade')}</option>
                <option value="word-highlight">{t('storyboard.subtitleAnimHighlight')}</option>
                <option value="karaoke">{t('storyboard.subtitleAnimKaraoke')}</option>
              </select>
            </div>
          </div>

          {/* Live preview */}
          <div className="space-y-1">
            <span className="text-[9px] text-c-dim uppercase font-medium">{t('storyboard.subtitlePreview')}</span>
            <div className="relative w-full rounded-lg overflow-hidden border border-c-border bg-gradient-to-br from-gray-800 to-gray-900" style={{ aspectRatio: '16/9', maxHeight: '160px' }}>
              <div className={clsx(
                'absolute left-0 right-0 flex px-4',
                subtitleStyle.position === 'top' ? 'top-3' : subtitleStyle.position === 'center' ? 'top-1/2 -translate-y-1/2' : 'bottom-3',
              )} style={{ paddingLeft: `${Math.max(8, subtitleStyle.marginX / 6)}px`, paddingRight: `${Math.max(8, subtitleStyle.marginX / 6)}px`, paddingBottom: subtitleStyle.position === 'bottom' ? `${subtitleStyle.marginBottom / 12}px` : undefined }}>
                <span
                  className={clsx(
                    'inline-block max-w-full leading-snug',
                    subtitleStyle.alignment === 'left' ? 'text-left mr-auto' : subtitleStyle.alignment === 'right' ? 'text-right ml-auto' : 'text-center mx-auto',
                  )}
                  style={{
                    fontFamily: subtitleStyle.fontFamily,
                    fontSize: `${Math.max(10, subtitleStyle.fontSize / 5)}px`,
                    fontWeight: subtitleStyle.fontWeight,
                    color: subtitleStyle.fontColor,
                    WebkitTextStroke: subtitleStyle.strokeWidth > 0 ? `${Math.max(0.3, subtitleStyle.strokeWidth / 4)}px ${subtitleStyle.strokeColor}` : undefined,
                    backgroundColor: subtitleStyle.bgOpacity > 0 ? `${subtitleStyle.bgColor}${Math.round(subtitleStyle.bgOpacity * 255).toString(16).padStart(2, '0')}` : undefined,
                    padding: subtitleStyle.bgOpacity > 0 ? '2px 6px' : undefined,
                    borderRadius: subtitleStyle.bgOpacity > 0 ? '3px' : undefined,
                  }}
                >
                  {displayText}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Collapsed mini-preview */}
      {subtitleStyle.enabled && !expanded && (
        <div className="flex items-center gap-2 text-[9px] text-c-dim">
          <span style={{ fontFamily: subtitleStyle.fontFamily, color: subtitleStyle.fontColor, fontSize: '11px', fontWeight: subtitleStyle.fontWeight }}>
            Aa
          </span>
          <span>{subtitleStyle.fontFamily} {subtitleStyle.fontSize}px</span>
          <span>|</span>
          <span>{subtitleStyle.position}</span>
          {subtitleStyle.animation !== 'none' && <><span>|</span><span>{subtitleStyle.animation}</span></>}
        </div>
      )}
    </div>
  );
}
