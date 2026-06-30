import { useEffect, useState } from 'react';

export const THEMES = ['midnight', 'ocean', 'emerald', 'sunset', 'daylight'] as const;
export type ThemeName = typeof THEMES[number];

const STORAGE_KEY = 'vcai-theme';

/** Themes that use light surfaces (for conditional styling) */
export function isLightTheme(t: ThemeName): boolean {
  return t === 'daylight';
}

function getInitialTheme(): ThemeName {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as ThemeName | null;
    if (stored && THEMES.includes(stored)) return stored;
    // Migrate old 'light'/'dark' values
    if (stored === 'light') return 'daylight';
    if (stored === 'dark') return 'midnight';
  } catch {}
  return 'midnight';
}

function applyTheme(theme: ThemeName) {
  const el = document.documentElement;
  el.setAttribute('data-theme', theme);
  // Keep .light class for backward compat
  if (isLightTheme(theme)) {
    el.classList.add('light');
  } else {
    el.classList.remove('light');
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeName>(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch {}
  }, [theme]);

  // Apply on first render (before hydration flash)
  useEffect(() => { applyTheme(getInitialTheme()); }, []);

  const toggle = () =>
    setTheme((t) => {
      const idx = THEMES.indexOf(t);
      return THEMES[(idx + 1) % THEMES.length];
    });

  return { theme, setTheme, toggle, themes: THEMES };
}
