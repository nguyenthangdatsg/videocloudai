import { create } from 'zustand';
import type { VideoProject, SceneMetadata, JobRecord, QueueStats } from '@videocloudai/shared';

interface AppStore {
  // Active video
  activeVideoId: string | null;
  setActiveVideoId: (id: string | null) => void;

  // Queue stats
  queueStats: QueueStats | null;
  setQueueStats: (stats: QueueStats) => void;

  // Live job updates from SSE
  liveJobs: Map<string, JobRecord>;
  updateLiveJob: (job: JobRecord) => void;

  // Sidebar state
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // Selected scene in library
  selectedSceneId: string | null;
  setSelectedSceneId: (id: string | null) => void;

  // Notification
  notifications: AppNotification[];
  notificationHistory: AppNotification[];
  unreadCount: number;
  pushNotification: (n: Omit<AppNotification, 'createdAt'>) => void;
  dismissNotification: (id: string) => void;
  markNotificationsRead: () => void;
  clearNotificationHistory: () => void;
}

interface AppNotification {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message?: string;
  createdAt: number;
}

export const useAppStore = create<AppStore>((set) => ({
  activeVideoId: null,
  setActiveVideoId: (id) => set({ activeVideoId: id }),

  queueStats: null,
  setQueueStats: (stats) => set({ queueStats: stats }),

  liveJobs: new Map(),
  updateLiveJob: (job) =>
    set((state) => {
      const next = new Map(state.liveJobs);
      next.set(job.id, job);
      return { liveJobs: next };
    }),

  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  selectedSceneId: null,
  setSelectedSceneId: (id) => set({ selectedSceneId: id }),

  notifications: [],
  notificationHistory: [],
  unreadCount: 0,
  pushNotification: (n) => {
    const full = { ...n, createdAt: Date.now() };
    set((s) => ({
      notifications: [...s.notifications, full],
      notificationHistory: [full, ...s.notificationHistory].slice(0, 50),
      unreadCount: s.unreadCount + 1,
    }));
    setTimeout(() => {
      set((s) => ({ notifications: s.notifications.filter((x) => x.id !== n.id) }));
    }, 5000);
  },
  dismissNotification: (id) =>
    set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })),
  markNotificationsRead: () => set({ unreadCount: 0 }),
  clearNotificationHistory: () => set({ notificationHistory: [], unreadCount: 0 }),
}));
