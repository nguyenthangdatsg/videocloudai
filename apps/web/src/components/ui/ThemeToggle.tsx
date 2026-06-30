import { useState, useRef, useEffect } from 'react';
import { Palette } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useTheme, THEMES, type ThemeName } from '../../hooks/useTheme';
import { clsx } from 'clsx';

const THEME_PREVIEW: Record<ThemeName, { dot: string; label: string }> = {
  midnight: { dot: 'bg-[#8578f6]', label: 'theme.midnight' },
  ocean:    { dot: 'bg-[#4d9cf5]', label: 'theme.ocean' },
  emerald:  { dot: 'bg-[#34d399]', label: 'theme.emerald' },
  sunset:   { dot: 'bg-[#f59e42]', label: 'theme.sunset' },
  daylight: { dot: 'bg-[#7c5cf0]', label: 'theme.daylight' },
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-8 h-8 flex items-center justify-center rounded-lg text-c-muted hover:text-c-text hover:bg-c-elevated transition-colors"
        title={t('theme.select')}
      >
        <Palette className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-40 py-1 rounded-lg border border-c-border bg-c-surface shadow-xl animate-fade-in">
          {THEMES.map((name) => {
            const info = THEME_PREVIEW[name];
            return (
              <button
                key={name}
                onClick={() => { setTheme(name); setOpen(false); }}
                className={clsx(
                  'w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors',
                  theme === name
                    ? 'bg-accent-muted text-c-accent font-medium'
                    : 'text-c-muted hover:text-c-text hover:bg-c-hover'
                )}
              >
                <span className={clsx('w-3 h-3 rounded-full shrink-0 ring-1 ring-white/20', info.dot)} />
                <span>{t(info.label)}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
