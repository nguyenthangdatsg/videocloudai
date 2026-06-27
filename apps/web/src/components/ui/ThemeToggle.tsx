import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../../hooks/useTheme';

export function ThemeToggle() {
  const { theme, toggle } = useTheme();

  return (
    <button
      onClick={toggle}
      className="w-8 h-8 flex items-center justify-center rounded-lg text-c-muted hover:text-c-text hover:bg-c-elevated transition-colors"
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </button>
  );
}
