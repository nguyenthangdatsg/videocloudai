import { clsx } from 'clsx';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useAppStore } from '../../store';

const ICONS = {
  success: CheckCircle,
  error: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const COLORS = {
  success: { icon: 'text-green-400', border: 'border-green-500/40', bg: 'bg-green-500/10' },
  error:   { icon: 'text-red-400',   border: 'border-red-500/40',   bg: 'bg-red-500/10' },
  warning: { icon: 'text-amber-400', border: 'border-amber-500/40', bg: 'bg-amber-500/10' },
  info:    { icon: 'text-blue-400',  border: 'border-blue-500/40',  bg: 'bg-blue-500/10' },
};

export function ToastContainer() {
  const { notifications, dismissNotification } = useAppStore();

  if (!notifications.length) return null;

  return (
    <div className="fixed top-[72px] right-6 z-[9999] flex flex-col gap-2 max-w-sm pointer-events-none">
      {notifications.slice(-4).map((n) => {
        const Icon = ICONS[n.type];
        const c = COLORS[n.type];
        return (
          <div
            key={n.id}
            onClick={() => dismissNotification(n.id)}
            className={clsx(
              'pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border',
              'bg-c-surface shadow-lg shadow-black/30 animate-slide-up cursor-pointer',
              'hover:opacity-90 transition-opacity',
              c.border, c.bg
            )}
          >
            <Icon className={clsx('w-4 h-4 mt-0.5 shrink-0', c.icon)} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-c-text">{n.title}</div>
              {n.message && (
                <div className="text-xs text-c-muted mt-0.5 break-words">{n.message}</div>
              )}
            </div>
            <X className="w-3.5 h-3.5 text-c-dim shrink-0 mt-0.5" />
          </div>
        );
      })}
    </div>
  );
}
