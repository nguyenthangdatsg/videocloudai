import { clsx } from 'clsx';

interface ProgressBarProps {
  value: number;
  max?: number;
  className?: string;
  showLabel?: boolean;
  color?: 'primary' | 'success' | 'warning' | 'error';
}

export function ProgressBar({ value, max = 100, className, showLabel, color = 'primary' }: ProgressBarProps) {
  const pct = Math.round((value / max) * 100);

  return (
    <div className={clsx('w-full', className)}>
      <div className="flex justify-between items-center mb-1">
        {showLabel && <span className="text-xs text-c-muted">{pct}%</span>}
      </div>
      <div className="w-full bg-c-elevated rounded-full h-1.5 overflow-hidden">
        <div
          className={clsx(
            'h-full rounded-full transition-all duration-300',
            color === 'primary' && 'bg-[#7c6af5]',
            color === 'success' && 'bg-green-500',
            color === 'warning' && 'bg-amber-500',
            color === 'error' && 'bg-red-500'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
