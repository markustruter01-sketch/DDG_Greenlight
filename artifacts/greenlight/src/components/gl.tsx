import { type ReactNode, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';
import { STATUS_COLOR, STATUS_WORD } from '@/lib/greenlight';

export function StatusPill({ status, text, small }: { status: string; text?: string; small?: boolean }) {
  const c = STATUS_COLOR[status] ?? '#CFE3EE';
  return (
    <span className={`inline-flex items-center gap-2 ${small ? 'text-xs' : 'text-sm'}`} data-testid={`status-${status}`}>
      <span className="dotx" style={{ background: c, boxShadow: `0 0 8px ${c}88` }} />
      <span style={{ color: '#F7FBFF' }}>{text || STATUS_WORD[status] || status}</span>
    </span>
  );
}

export function Dot({ color, word }: { color: string; word: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="dotx" style={{ background: color, boxShadow: `0 0 8px ${color}88` }} />
      <span>{word}</span>
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  z = 60,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
  z?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 flex items-center justify-center p-3 sm:p-6"
          style={{ zIndex: z, background: 'rgba(3,10,14,.7)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(e) => e.target === e.currentTarget && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            className={`glass flex max-h-[90dvh] w-full flex-col overflow-hidden ${wide ? 'max-w-5xl' : 'max-w-2xl'}`}
            style={{ background: 'rgba(8,24,33,.9)' }}
            initial={{ y: 24, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 16, opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            <div className="flex items-center justify-between gap-4 border-b px-5 py-4" style={{ borderColor: 'rgba(124,201,232,.2)' }}>
              <h2 className="font-head text-lg font-semibold">{title}</h2>
              <button className="btn !p-2" onClick={onClose} aria-label="Close" data-testid="button-close-modal">
                <X size={16} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Gauge({ value, size = 56, color = '#00E5FF', label }: { value: number; size?: number; color?: string; label?: ReactNode }) {
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(124,201,232,.18)" strokeWidth={4} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={4}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.min(100, Math.max(0, value)) / 100)}
          style={{ transition: 'stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center font-head text-sm font-semibold">{label ?? `${value}`}</div>
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skel ${className}`} />;
}

export function ErrorBlock({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="glass mx-auto my-10 max-w-md p-6 text-center">
      <Dot color="#FF5C6E" word="Could not load" />
      <p className="mt-2 text-sm" style={{ color: '#CFE3EE' }}>
        {message || 'The request failed.'}
      </p>
      {onRetry && (
        <button className="btn btn-primary mt-4" onClick={onRetry} data-testid="button-retry">
          Retry
        </button>
      )}
    </div>
  );
}
