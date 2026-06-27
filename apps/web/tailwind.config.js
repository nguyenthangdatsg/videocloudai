/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // Theme-aware CSS variable tokens (auto-switch with .light class on <html>)
        'c-bg':        'var(--c-bg)',
        'c-surface':   'var(--c-surface)',
        'c-elevated':  'var(--c-elevated)',
        'c-hover':     'var(--c-hover)',
        'c-border':    'var(--c-border)',
        'c-border-hi': 'var(--c-border-hi)',
        'c-text':      'var(--c-text)',
        'c-muted':     'var(--c-muted)',
        'c-dim':       'var(--c-dim)',
        accent: {
          primary: '#7c6af5',
          hover: '#9180ff',
          muted: '#7c6af520',
          glow: '#7c6af540',
        },
        status: {
          success: '#22c55e',
          warning: '#f59e0b',
          error: '#ef4444',
          info: '#3b82f6',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Inter', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.2s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: { from: { transform: 'translateY(8px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
      },
    },
  },
  plugins: [],
};
