import { useRef } from 'react';
import { clsx } from 'clsx';
import { useTranslation } from 'react-i18next';
import {
  Crop,
  FlipHorizontal,
  FlipVertical,
  RotateCw,
  ImagePlus,
  Trash2,
  Move,
  RefreshCw,
} from 'lucide-react';
import { useEditorAIStore, DEFAULT_FRAME_TRANSFORM } from '../store';
import type { LogoPosition } from '../store';

// Crop preset options — the label "No crop" is translated; the ratio labels are universal.
const CROP_PRESETS: Array<{ id: string; ratioLabel: string; ratio: number | null; emoji: string }> = [
  { id: 'none', ratioLabel: '',     ratio: null,  emoji: '⬚' },
  { id: '9-16', ratioLabel: '9:16', ratio: 9 / 16, emoji: '📱' },
  { id: '1-1',  ratioLabel: '1:1',  ratio: 1,      emoji: '⬛' },
  { id: '4-5',  ratioLabel: '4:5',  ratio: 4 / 5,  emoji: '🖼' },
  { id: '16-9', ratioLabel: '16:9', ratio: 16 / 9, emoji: '🖥' },
  { id: '4-3',  ratioLabel: '4:3',  ratio: 4 / 3,  emoji: '📺' },
];

const LOGO_POSITIONS: Array<{ id: LogoPosition; label: string }> = [
  { id: 'top-left',     label: '↖' },
  { id: 'top-right',    label: '↗' },
  { id: 'center',       label: '◯' },
  { id: 'bottom-left',  label: '↙' },
  { id: 'bottom-right', label: '↘' },
];

// Build a normalized crop box for a given target aspect (assumes source 16:9 by default;
// the actual visible aspect inside the cropped player will match the requested ratio).
function cropForAspect(ratio: number): { x: number; y: number; width: number; height: number } {
  // Source aspect we assume — most imported social videos are 9:16 portrait. We center the
  // crop on the source. If the target ratio is wider than source, fill width; otherwise fill height.
  // We don't know the source aspect for sure here so we pick a centered safe crop:
  //   - width = min(1, ratio / sourceRatio), height = width / ratio * sourceRatio
  // Easier UX: just give a centered square-ish region scaled to the ratio.
  if (ratio >= 1) {
    // Landscape-ish: keep full width, reduce height
    const height = Math.min(1, 1 / ratio);
    return { x: 0, y: (1 - height) / 2, width: 1, height };
  } else {
    // Portrait: keep full height, reduce width
    const width = Math.min(1, ratio);
    return { x: (1 - width) / 2, y: 0, width, height: 1 };
  }
}

function Section({ title, icon: Icon, children }: { title: string; icon: typeof Crop; children: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="w-3 h-3 text-[#9180ff]" />
        <h4 className="text-xs font-medium text-c-muted uppercase tracking-wider">{title}</h4>
      </div>
      {children}
    </div>
  );
}

export function TransformPanel() {
  const { t } = useTranslation();
  const transform = useEditorAIStore((s) => s.frameTransform);
  const updateTransform = useEditorAIStore((s) => s.updateTransform);
  const resetTransform = useEditorAIStore((s) => s.resetTransform);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleLogoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    // Use a data URL so it survives reloads via store (no need for upload endpoint)
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        updateTransform({ logoUrl: reader.result });
      }
    };
    reader.readAsDataURL(file);
  }

  function activeCropId(): string {
    if (!transform.crop) return 'none';
    const { width, height } = transform.crop;
    const ratio = (width || 0.0001) / (height || 0.0001);
    const closest = CROP_PRESETS.filter((p) => p.ratio !== null).reduce<{ id: string; diff: number }>(
      (acc, p) => {
        const diff = Math.abs((p.ratio as number) - ratio);
        return diff < acc.diff ? { id: p.id, diff } : acc;
      },
      { id: 'custom', diff: Number.POSITIVE_INFINITY }
    );
    return closest.diff < 0.05 ? closest.id : 'custom';
  }
  const currentCrop = activeCropId();

  const dirty =
    transform.crop !== DEFAULT_FRAME_TRANSFORM.crop ||
    transform.flipH ||
    transform.flipV ||
    transform.rotation !== 0 ||
    !!transform.logoUrl;

  return (
    <div className="overflow-auto p-4 h-full space-y-5 text-c-text">
      {/* ── Crop ─────────────────────────────────────────────────── */}
      <Section title={t('editor.transform.crop')} icon={Crop}>
        <div className="grid grid-cols-3 gap-1.5">
          {CROP_PRESETS.map((p) => {
            const isActive = currentCrop === p.id;
            const label = p.id === 'none' ? t('editor.transform.cropNone') : p.ratioLabel;
            return (
              <button
                key={p.id}
                onClick={() =>
                  updateTransform({ crop: p.ratio === null ? null : cropForAspect(p.ratio) })
                }
                className={clsx(
                  'flex flex-col items-center justify-center gap-0.5 px-2 py-2 rounded-lg border text-xs transition-colors',
                  isActive
                    ? 'bg-[#7c6af520] border-[#7c6af5] text-[#9180ff]'
                    : 'border-c-border text-c-muted hover:border-c-border-hi hover:text-c-text'
                )}
              >
                <span className="text-sm">{p.emoji}</span>
                <span>{label}</span>
              </button>
            );
          })}
        </div>

        {/* Manual crop sliders */}
        {transform.crop && (
          <div className="mt-3 p-3 bg-c-bg border border-c-border rounded-lg space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] text-c-dim">
              <Move className="w-3 h-3" />
              <span>{t('editor.transform.fineTune')}</span>
            </div>
            {(['x', 'y', 'width', 'height'] as const).map((key) => (
              <label key={key} className="flex items-center gap-2 text-[11px]">
                <span className="w-12 text-c-dim uppercase">{key}</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={transform.crop![key]}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    updateTransform({
                      crop: { ...transform.crop!, [key]: v },
                    });
                  }}
                  className="flex-1 accent-[#7c6af5]"
                />
                <span className="w-8 text-right font-mono text-c-muted">
                  {transform.crop![key].toFixed(2)}
                </span>
              </label>
            ))}
          </div>
        )}
      </Section>

      {/* ── Flip & Rotate ────────────────────────────────────────── */}
      <Section title={t('editor.transform.flipRotate')} icon={FlipHorizontal}>
        <div className="grid grid-cols-2 gap-1.5 mb-2">
          <button
            onClick={() => updateTransform({ flipH: !transform.flipH })}
            className={clsx(
              'flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs transition-colors',
              transform.flipH
                ? 'bg-[#7c6af520] border-[#7c6af5] text-[#9180ff]'
                : 'border-c-border text-c-muted hover:border-c-border-hi hover:text-c-text'
            )}
          >
            <FlipHorizontal className="w-3.5 h-3.5" />
            {t('editor.transform.flipHorizontal')}
          </button>
          <button
            onClick={() => updateTransform({ flipV: !transform.flipV })}
            className={clsx(
              'flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border text-xs transition-colors',
              transform.flipV
                ? 'bg-[#7c6af520] border-[#7c6af5] text-[#9180ff]'
                : 'border-c-border text-c-muted hover:border-c-border-hi hover:text-c-text'
            )}
          >
            <FlipVertical className="w-3.5 h-3.5" />
            {t('editor.transform.flipVertical')}
          </button>
        </div>
        <button
          onClick={() => {
            const next = ((transform.rotation + 90) % 360) as 0 | 90 | 180 | 270;
            updateTransform({ rotation: next });
          }}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-c-border text-xs text-c-muted hover:border-c-border-hi hover:text-c-text transition-colors"
        >
          <RotateCw className="w-3.5 h-3.5" />
          {t('editor.transform.rotate', { deg: transform.rotation })}
        </button>
      </Section>

      {/* ── Logo / Watermark ─────────────────────────────────────── */}
      <Section title={t('editor.transform.logo')} icon={ImagePlus}>
        {!transform.logoUrl ? (
          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-full flex flex-col items-center justify-center gap-2 px-3 py-5 rounded-lg border-2 border-dashed border-c-border text-c-dim hover:border-[#7c6af5] hover:text-[#9180ff] transition-colors"
          >
            <ImagePlus className="w-5 h-5" />
            <span className="text-xs">{t('editor.transform.uploadLogo')}</span>
          </button>
        ) : (
          <div className="space-y-2">
            <div className="flex items-start gap-2 p-2 bg-c-bg border border-c-border rounded-lg">
              <img
                src={transform.logoUrl}
                alt=""
                className="w-10 h-10 object-contain rounded bg-checker"
                style={{
                  backgroundImage:
                    'linear-gradient(45deg, rgba(255,255,255,0.05) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.05) 75%), linear-gradient(45deg, rgba(255,255,255,0.05) 25%, transparent 25%, transparent 75%, rgba(255,255,255,0.05) 75%)',
                  backgroundSize: '8px 8px',
                  backgroundPosition: '0 0, 4px 4px',
                }}
              />
              <div className="flex-1 min-w-0 text-[11px] text-c-dim">
                {t('editor.transform.logoLoaded')}<br />
                {t('editor.transform.logoHint')}
              </div>
              <button
                onClick={() => updateTransform({ logoUrl: null })}
                className="p-1 rounded hover:bg-red-900/30 text-c-dim hover:text-red-400 transition-colors"
                title={t('editor.transform.removeLogo')}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Position picker — 5 corners grid */}
            <div className="grid grid-cols-3 gap-1">
              {LOGO_POSITIONS.map((p) => {
                const isActive = transform.logoPosition === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => updateTransform({ logoPosition: p.id })}
                    className={clsx(
                      'aspect-square flex items-center justify-center rounded border text-base transition-colors',
                      isActive
                        ? 'bg-[#7c6af520] border-[#7c6af5] text-[#9180ff]'
                        : 'border-c-border text-c-dim hover:border-c-border-hi hover:text-c-text'
                    )}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>

            {/* Size + opacity */}
            <label className="flex items-center gap-2 text-[11px]">
              <span className="w-12 text-c-dim">{t('editor.transform.size')}</span>
              <input
                type="range"
                min={5}
                max={50}
                step={1}
                value={transform.logoSize}
                onChange={(e) => updateTransform({ logoSize: parseInt(e.target.value, 10) })}
                className="flex-1 accent-[#7c6af5]"
              />
              <span className="w-10 text-right font-mono text-c-muted">{transform.logoSize}%</span>
            </label>
            <label className="flex items-center gap-2 text-[11px]">
              <span className="w-12 text-c-dim">{t('editor.transform.opacity')}</span>
              <input
                type="range"
                min={0.1}
                max={1}
                step={0.05}
                value={transform.logoOpacity}
                onChange={(e) => updateTransform({ logoOpacity: parseFloat(e.target.value) })}
                className="flex-1 accent-[#7c6af5]"
              />
              <span className="w-10 text-right font-mono text-c-muted">
                {Math.round(transform.logoOpacity * 100)}%
              </span>
            </label>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          onChange={handleLogoUpload}
          className="hidden"
        />
      </Section>

      {/* ── Reset ────────────────────────────────────────────────── */}
      {dirty && (
        <button
          onClick={resetTransform}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-c-border text-xs text-c-dim hover:text-red-400 hover:border-red-700/50 transition-colors"
        >
          <RefreshCw className="w-3 h-3" />
          {t('editor.transform.resetAll')}
        </button>
      )}

      <div className="text-[10px] text-c-dim leading-relaxed pt-2 border-t border-c-border">
        {t('editor.transform.footnote')}
      </div>
    </div>
  );
}
