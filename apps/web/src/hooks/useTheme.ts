import { useEffect, useState } from 'react';

export type Theme = 'dark' | 'light';

const STORAGE_KEY = 'vcai-theme';

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {}
  return 'dark';
}

function applyTheme(theme: Theme) {
  if (theme === 'light') {
    document.documentElement.classList.add('light');
  } else {
    document.documentElement.classList.remove('light');
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    try { localStorage.setItem(STORAGE_KEY, theme); } catch {}
  }, [theme]);

  // Apply on first render (before hydration flash)
  useEffect(() => { applyTheme(getInitialTheme()); }, []);

  const toggle = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return { theme, toggle };
}
