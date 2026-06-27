import { useTranslation } from 'react-i18next';
import { LANGUAGES, type SupportedLang } from '../../i18n';
import { clsx } from 'clsx';

interface LangSwitcherProps {
  collapsed?: boolean;
}

export function LangSwitcher({ collapsed }: LangSwitcherProps) {
  const { i18n } = useTranslation();
  const current = i18n.language as SupportedLang;

  const toggle = () => {
    const next: SupportedLang = current === 'en' ? 'vi' : 'en';
    i18n.changeLanguage(next);
    localStorage.setItem('lang', next);
  };

  const currentLang = LANGUAGES.find((l) => l.code === current) ?? LANGUAGES[0];
  const nextLang = LANGUAGES.find((l) => l.code !== current) ?? LANGUAGES[1];

  return (
    <button
      onClick={toggle}
      title={`Switch to ${nextLang.label}`}
      className={clsx(
        'flex items-center gap-2 px-2 py-1.5 rounded-lg border border-c-border',
        'bg-c-surface hover:bg-c-elevated hover:border-[#7c6af5] transition-colors text-xs font-medium',
        collapsed ? 'justify-center w-full' : ''
      )}
    >
      <span className="text-sm leading-none">{currentLang.flag}</span>
      {!collapsed && (
        <span className="text-c-muted hover:text-c-text transition-colors">
          {currentLang.code.toUpperCase()}
        </span>
      )}
    </button>
  );
}
