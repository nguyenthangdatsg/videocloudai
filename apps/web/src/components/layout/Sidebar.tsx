import { Link, useLocation } from 'react-router-dom';
import { clsx } from 'clsx';
import {
  LayoutDashboard,
  FileText,
  Library,
  Video,
  Layers,
  ListChecks,
  Settings,
  Zap,
  ChevronLeft,
  Share2,
  BarChart2,
  Mic,
  FileAudio,
  Image,
  Clapperboard,
  Film,
  Loader2,
} from 'lucide-react';
import { useAppStore } from '../../store';
import { useImageGenStore } from '../../store/image-generation';
import { useQuery } from '@tanstack/react-query';
import { queueApi, settingsApi } from '../../lib/api';
import { useTranslation } from 'react-i18next';
import { LangSwitcher } from '../ui/LangSwitcher';

export function Sidebar() {
  const location = useLocation();
  const { sidebarCollapsed, toggleSidebar } = useAppStore();
  const hasRunningImageGen = useImageGenStore((s) =>
    Array.from(s.tasks.values()).some((t) => t.running),
  );
  const { t } = useTranslation();

  const NAV_ITEMS = [
    { path: '/', icon: LayoutDashboard, label: t('nav.dashboard') },
    { path: '/script', icon: FileText, label: t('nav.scriptEditor') },
    { path: '/library', icon: Library, label: t('nav.sceneLibrary') },
    { path: '/editor', icon: Video, label: t('nav.videoEditor') },
    { path: '/batch', icon: Layers, label: t('nav.batchGenerator') },
    { path: '/queue', icon: ListChecks, label: t('nav.queue') },
    { path: '/tts', icon: Mic, label: t('nav.tts') },
    { path: '/transcribe', icon: FileAudio, label: t('nav.transcribe') },
    { path: '/image', icon: Image, label: t('nav.imageGenerator') },
    { path: '/storyboard', icon: Clapperboard, label: t('nav.storyboard') },
    { path: '/drama', icon: Film, label: t('nav.dramaStudio') },
    { path: '/channels', icon: Share2, label: t('nav.channels') },
    { path: '/distributions', icon: BarChart2, label: t('nav.distributions') },
    { path: '/settings', icon: Settings, label: t('nav.settings') },
  ];

  const { data: appSettings } = useQuery({
    queryKey: ['settings'],
    queryFn: settingsApi.get,
    staleTime: 60_000,
  });
  const appName = appSettings?.app_name || 'VideoCloudAI';
  const appLogoUrl = appSettings?.app_logo_url || '';

  const { data: queueStats } = useQuery({
    queryKey: ['queue', 'stats'],
    queryFn: queueApi.stats,
    refetchInterval: 5000,
  });

  return (
    <aside
      className={clsx(
        'flex flex-col border-r border-c-border bg-c-bg transition-all duration-200 shrink-0',
        sidebarCollapsed ? 'w-16' : 'w-56'
      )}
    >
      {/* Logo */}
      <div className="flex items-center gap-2 px-4 py-5 border-b border-c-border">
        <Link to="/" className="flex items-center gap-2 min-w-0 hover:opacity-80 transition-opacity">
          {appLogoUrl ? (
            <img src={appLogoUrl} alt={appName} className="w-7 h-7 rounded-lg object-cover shrink-0" />
          ) : (
            <div className="w-7 h-7 rounded-lg bg-accent-primary flex items-center justify-center shrink-0">
              <Zap className="w-4 h-4 text-white" />
            </div>
          )}
          {!sidebarCollapsed && (
            <span className="font-semibold text-sm text-c-text truncate">{appName}</span>
          )}
        </Link>
        <button
          onClick={toggleSidebar}
          className={clsx(
            'ml-auto p-1 rounded hover:bg-c-elevated text-c-muted hover:text-c-text transition-colors',
            sidebarCollapsed && 'rotate-180'
          )}
        >
          <ChevronLeft className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-3 px-2 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map(({ path, icon: Icon, label }) => {
          const active = path === '/'
            ? location.pathname === '/'
            : location.pathname.startsWith(path);
          const hasRunningGen = path === '/storyboard' && hasRunningImageGen;
          return (
            <Link
              key={path}
              to={path}
              className={clsx(
                'flex items-center gap-3 px-2 py-2 rounded-lg text-sm transition-colors',
                active
                  ? 'bg-accent-muted text-c-accent font-medium'
                  : 'text-c-muted hover:text-c-text hover:bg-c-surface'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed && <span className="flex-1">{label}</span>}
              {hasRunningGen && <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin shrink-0" />}
            </Link>
          );
        })}
      </nav>

      {/* Queue status */}
      {!sidebarCollapsed && queueStats && (
        <div className="px-3 pb-2">
          <div className="bg-c-surface border border-c-border rounded-lg p-3">
            <div className="text-xs text-c-muted mb-2 font-medium uppercase tracking-wider">
              {t('dashboard.queueSummary')}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                { label: t('queue.running'), value: queueStats.running, color: 'text-blue-400' },
                { label: t('queue.queued'), value: queueStats.queued, color: 'text-c-muted' },
                { label: t('queue.done'), value: queueStats.completed, color: 'text-green-400' },
                { label: t('queue.failed'), value: queueStats.failed, color: 'text-red-400' },
              ].map(({ label, value, color }) => (
                <div key={label}>
                  <div className={clsx('text-sm font-semibold', color)}>{value}</div>
                  <div className="text-xs text-c-dim">{label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Language switcher */}
      <div className={clsx('px-3 pb-4', sidebarCollapsed ? 'flex justify-center' : '')}>
        <LangSwitcher collapsed={sidebarCollapsed} />
      </div>
    </aside>
  );
}
