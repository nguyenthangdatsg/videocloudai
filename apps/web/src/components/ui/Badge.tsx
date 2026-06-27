import { clsx } from 'clsx';

interface BadgeProps {
  children: React.ReactNode;
  mood?: string;
  variant?: 'default' | 'outline' | 'success' | 'warning' | 'error';
  className?: string;
}

export function Badge({ children, mood, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={clsx(
        'badge',
        mood && `mood-${mood}`,
        !mood && {
          'bg-c-elevated text-c-muted border border-c-border': variant === 'default',
          'border border-c-border text-c-muted': variant === 'outline',
          'bg-green-900/30 text-green-300 border border-green-800/30': variant === 'success',
          'bg-amber-900/30 text-amber-300 border border-amber-800/30': variant === 'warning',
          'bg-red-900/30 text-red-300 border border-red-800/30': variant === 'error',
        },
        className
      )}
    >
      {children}
    </span>
  );
}
