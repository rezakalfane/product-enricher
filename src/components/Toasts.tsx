'use client';

import { clsx } from 'clsx';
import { useEffect, useState } from 'react';
import { AlertIcon, CheckIcon, SparkIcon, XIcon } from './icons';

export type Toast = {
  id: string;
  tone: 'success' | 'info' | 'error';
  title: string;
  body: string;
  link?: { label: string; onClick: () => void };
};

const DISMISS_AFTER_MS = 20_000;

/** Bottom-right stack of transient notifications. Hovering one keeps it on screen. */
export function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-5 right-5 z-40 flex w-[min(360px,calc(100vw-2.5rem))] flex-col gap-2"
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [hovered, setHovered] = useState(false);

  useEffect(() => {
    if (hovered) return;
    const t = setTimeout(onDismiss, DISMISS_AFTER_MS);
    return () => clearTimeout(t);
  }, [hovered, onDismiss]);

  const Icon = toast.tone === 'error' ? AlertIcon : toast.tone === 'success' ? CheckIcon : SparkIcon;

  return (
    <div
      role="status"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="animate-fade-up pointer-events-auto flex items-start gap-3 rounded-xl border border-bc-line bg-white p-3.5 shadow-lg"
    >
      <div
        className={clsx(
          'grid size-7 shrink-0 place-items-center rounded-lg',
          toast.tone === 'success' && 'bg-emerald-50 text-bc-green',
          toast.tone === 'info' && 'bg-bc-blue-50 text-bc-blue-500',
          toast.tone === 'error' && 'bg-red-50 text-bc-red',
        )}
      >
        <Icon className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-bc-ink">{toast.title}</p>
        <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-bc-muted" title={toast.body}>
          {toast.body}
        </p>
        {toast.link && (
          <button
            onClick={() => {
              toast.link!.onClick();
              onDismiss();
            }}
            className="mt-1.5 text-[12px] font-semibold text-bc-blue-600 underline-offset-2 hover:underline"
          >
            {toast.link.label}
          </button>
        )}
      </div>
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        className="grid size-6 shrink-0 place-items-center rounded-md text-bc-muted transition hover:bg-bc-surface hover:text-bc-ink"
      >
        <XIcon className="size-3.5" />
      </button>
    </div>
  );
}
