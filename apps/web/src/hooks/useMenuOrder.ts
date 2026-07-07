import { useState, useCallback, useSyncExternalStore } from 'react';

const STORAGE_KEY = 'sidebar_menu_order';

// Shared listeners so all components react to changes
let listeners: Array<() => void> = [];
function subscribe(cb: () => void) {
  listeners.push(cb);
  return () => { listeners = listeners.filter((l) => l !== cb); };
}
function getSnapshot(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}
function notify() {
  listeners.forEach((l) => l());
}

/** Returns the saved path order (or null if default). */
export function useMenuOrderStore(): string[] | null {
  const raw = useSyncExternalStore(subscribe, getSnapshot);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

/** Save a new order and notify all subscribers. */
export function saveMenuOrder(paths: string[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(paths));
  notify();
}

/** Reset to default order. */
export function resetMenuOrder() {
  localStorage.removeItem(STORAGE_KEY);
  notify();
}

/** Hook for the settings page: provides ordered items + move helpers. */
export function useMenuOrderEditor(defaultPaths: string[]) {
  const stored = useMenuOrderStore();
  const [order, setOrder] = useState<string[]>(() => {
    if (!stored) return defaultPaths;
    // Merge: keep stored order but add any new paths not yet in it, remove deleted ones
    const known = new Set(defaultPaths);
    const ordered = stored.filter((p) => known.has(p));
    const missing = defaultPaths.filter((p) => !ordered.includes(p));
    return [...ordered, ...missing];
  });

  const move = useCallback((from: number, to: number) => {
    setOrder((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      saveMenuOrder(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setOrder(defaultPaths);
    resetMenuOrder();
  }, [defaultPaths]);

  return { order, move, reset };
}
