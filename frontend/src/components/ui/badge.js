import { cn } from '@/lib/utils';

const BADGE_VARIANTS = {
  default: 'bg-surface-muted text-ink border-border',
  burgundy: 'bg-burgundy/10 text-burgundy dark:bg-burgundy/25 dark:text-rose-200 border-burgundy/20',
  midnight: 'bg-midnight/10 text-midnight dark:bg-slate-700/50 dark:text-slate-200 border-midnight/20',
  success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  warning: 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  danger: 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300 border-red-200 dark:border-red-800',
};

export function Badge({ variant = 'default', className, children }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap',
        BADGE_VARIANTS[variant] || BADGE_VARIANTS.default,
        className
      )}
    >
      {children}
    </span>
  );
}

export function statusBadgeVariant(status) {
  switch (status) {
    case 'completed':
      return 'success';
    case 'processing':
    case 'queued':
    case 'uploading':
    case 'recording':
    case 'in_progress':
      return 'warning';
    case 'failed':
    case 'urgent':
      return 'danger';
    case 'scheduled':
      return 'midnight';
    default:
      return 'default';
  }
}

