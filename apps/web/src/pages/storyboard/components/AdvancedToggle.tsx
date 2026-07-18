import { useState } from 'react';
import { ChevronDown, ChevronRight, Settings2 } from 'lucide-react';
import { clsx } from 'clsx';

interface AdvancedToggleProps {
  label: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}

export function AdvancedToggle({ label, children, defaultOpen = false, className }: AdvancedToggleProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={clsx('border border-c-border/50 rounded-lg overflow-hidden', className)}>
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 flex items-center gap-2 text-left hover:bg-c-elevated/30 transition-colors"
      >
        <Settings2 className="w-3 h-3 text-c-dim" />
        <span className="text-[11px] text-c-dim font-medium flex-1">{label}</span>
        {open ? <ChevronDown className="w-3 h-3 text-c-dim" /> : <ChevronRight className="w-3 h-3 text-c-dim" />}
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t border-c-border/30">
          {children}
        </div>
      )}
    </div>
  );
}
