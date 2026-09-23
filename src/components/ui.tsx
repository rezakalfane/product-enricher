'use client';

import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
};

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap',
        'transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-45',
        size === 'sm' ? 'h-8 px-3 text-[13px]' : 'h-10 px-4 text-sm',
        variant === 'primary' &&
          'bg-bc-blue-500 text-white shadow-sm hover:bg-bc-blue-600 active:bg-bc-blue-700',
        variant === 'secondary' &&
          'border border-bc-line bg-white text-bc-slate shadow-xs hover:border-bc-blue-300 hover:text-bc-blue-600',
        variant === 'ghost' && 'text-bc-muted hover:bg-bc-surface hover:text-bc-ink',
        variant === 'danger' && 'border border-transparent bg-bc-red/10 text-bc-red hover:bg-bc-red/15',
        className,
      )}
    >
      {loading && <Spinner className="size-3.5" />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx('animate-spin', className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

const TONES = {
  neutral: 'bg-bc-surface text-bc-muted ring-bc-line',
  blue: 'bg-bc-blue-50 text-bc-blue-700 ring-bc-blue-200',
  green: 'bg-emerald-50 text-bc-green ring-emerald-200',
  amber: 'bg-amber-50 text-bc-amber ring-amber-200',
  red: 'bg-red-50 text-bc-red ring-red-200',
  teal: 'bg-teal-50 text-bc-teal ring-teal-200',
} as const;

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold',
        'ring-1 ring-inset tracking-wide',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Confidence shown as a compact meter — colour encodes how safe auto-applying would be. */
export function ConfidenceMeter({ value }: { value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const tone = pct >= 80 ? 'bg-bc-green' : pct >= 55 ? 'bg-bc-amber' : 'bg-bc-red';
  return (
    <div className="flex items-center gap-2" title={`${pct}% match confidence`}>
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-bc-line">
        <div className={clsx('h-full rounded-full transition-all', tone)} style={{ width: `${pct}%` }} />
      </div>
      <span className="tnum text-[11px] font-semibold text-bc-muted">{pct}%</span>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-20 text-center">
      <div className="grid size-12 place-items-center rounded-xl bg-bc-blue-50 text-bc-blue-500">
        {icon}
      </div>
      <div>
        <p className="text-sm font-semibold text-bc-ink">{title}</p>
        <p className="mx-auto mt-1 max-w-sm text-[13px] leading-relaxed text-bc-muted">{body}</p>
      </div>
      {action}
    </div>
  );
}
