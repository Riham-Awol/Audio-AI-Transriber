'use client';

import { forwardRef } from 'react';
import { cn } from '@/lib/utils';

const VARIANT_STYLES = {
  primary: 'bg-burgundy text-white hover:bg-burgundy-deep shadow-sm',
  secondary: 'bg-midnight text-white hover:bg-midnight-light shadow-sm',
  outline:
    'border border-border bg-surface text-ink hover:bg-surface-muted',
  ghost: 'text-ink-muted hover:text-ink hover:bg-surface-muted',
  danger: 'bg-red-600 text-white hover:bg-red-700 shadow-sm',
};

const SIZE_STYLES = {
  sm: 'h-8 px-3 text-xs rounded-md gap-1.5',
  md: 'h-9 px-4 text-sm rounded-lg gap-2',
  lg: 'h-11 px-5 text-sm rounded-lg gap-2',
  icon: 'h-9 w-9 rounded-lg justify-center',
};

export const Button = forwardRef(function Button(
  { className, variant = 'primary', size = 'md', type = 'button', disabled, children, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center font-medium transition-colors duration-150 disabled:opacity-50 disabled:pointer-events-none select-none',
        VARIANT_STYLES[variant] || VARIANT_STYLES.primary,
        SIZE_STYLES[size] || SIZE_STYLES.md,
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
});

