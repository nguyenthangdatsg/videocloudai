import { Bell, X, CheckCircle, AlertCircle, Info, AlertTriangle, Trash2 } from 'lucide-react';
import { useAppStore } from '../../store';
import { ThemeToggle } from '../ui/ThemeToggle';
import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { clsx } from 'clsx';

interface TopBarProps {
  // ReactNode so pages can pass an inline-editable title component, not just a static string
  title: React.ReactNode;
  subtitle?: string;
  actions?: React.ReactNode;
}

const ICONS = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const COLORS = {
  success: { icon: 'text-green-400', dot: 'bg-green-400', border: 'border-green-500/30', bg: 'bg-green-500/10' },
  error:   { icon: 'text-red-400',   dot: 'bg-red-400',   border: 'border-red-500/30',   bg: 'bg-red-500/10'   },
  warning: { icon: 'text-amber-400', dot: 'bg-amber-400', border: 'border-amber-500/30', bg: 'bg-amber-500/10' },
  info:    { icon: 'text-blue-400',  dot: 'bg-blue-400',  border: 'border-blue-500/30',  bg: 'bg-blue-500/10'  },
};

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function TopBar({ title, subtitle, actions }: TopBarProps) {
  const { t } = useTranslation();
  const { notificationHistory, unreadCount, markNotificationsRead, clearNotificationHistory } = useAppStore();
  const [panelOpen, setPanelOpen] = useState(false);
  const bellWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!panelOpen) return;
    function onMouseDown(e: MouseEvent) {
      if (bellWrapRef.current && !bellWrapRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [panelOpen]);

  function togglePanel() {
    const next = !panelOpen;
    setPanelOpen(next);
    if (next) markNotificationsRead();
  }

  return (
    <header className="flex items-center px-4 py-1 border-b border-c-border bg-c-bg shrink-0">
      <div className="min-w-0 flex-1 mr-4 overflow-hidden">
        {typeof title === 'string'
          ? <h1 className="text-sm font-semibold text-c-text leading-tight truncate whitespace-nowrap">{title}</h1>
          : title}
        {subtitle && <p className="text-[11px] text-c-muted truncate whitespace-nowrap">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {actions}
        <ThemeToggle />

        {/* Bell with dropdown panel */}
        <div className="relative" ref={bellWrapRef}>
          <button
            onClick={togglePanel}
            className={clsx(
              'p-2 rounded-lg text-c-muted hover:text-c-text transition-colors relative',
              panelOpen ? 'bg-c-elevated text-c-text' : 'hover:bg-c-elevated'
            )}
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-accent-primary text-white text-[9px] font-bold px-0.5">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {panelOpen && (
            <div className="absolute right-0 top-full mt-2 w-80 bg-c-surface border border-c-border rounded-xl shadow-2xl shadow-black/40 z-[200] overflow-hidden flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-c-border">
                <span className="text-xs font-semibold text-c-text uppercase tracking-wider">
                  {t('notifications.title')}
                </span>
                <div className="flex items-center gap-1">
                  {notificationHistory.length > 0 && (
                    <button
                      onClick={clearNotificationHistory}
                      className="p-1 rounded text-c-dim hover:text-red-400 transition-colors"
                      title={t('notifications.clearAll')}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                  <button
                    onClick={() => setPanelOpen(false)}
                    className="p-1 rounded text-c-dim hover:text-c-text transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* List */}
              <div className="overflow-y-auto max-h-96">
                {notificationHistory.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 text-c-dim">
                    <Bell className="w-6 h-6 mb-2 opacity-30" />
                    <p className="text-xs">{t('notifications.empty')}</p>
                  </div>
                ) : (
                  notificationHistory.map((n) => {
                    const Icon = ICONS[n.type];
                    const c = COLORS[n.type];
                    return (
                      <div
                        key={`${n.id}-${n.createdAt}`}
                        className={clsx(
                          'flex items-start gap-3 px-4 py-3 border-b border-c-border/50 last:border-0',
                          'hover:bg-c-elevated/60 transition-colors',
                          c.bg
                        )}
                      >
                        <span className={clsx('mt-0.5 shrink-0', c.dot, 'w-2 h-2 rounded-full mt-1.5')} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-medium text-c-text leading-snug">{n.title}</p>
                            <Icon className={clsx('w-3.5 h-3.5 shrink-0 mt-0.5', c.icon)} />
                          </div>
                          {n.message && (
                            <p className="text-[11px] text-c-muted mt-0.5 break-words leading-relaxed">{n.message}</p>
                          )}
                          <p className="text-[10px] text-c-dim mt-1">{timeAgo(n.createdAt)}</p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
