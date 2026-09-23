'use client';

import { clsx } from 'clsx';
import { useCallback, useRef, useState } from 'react';
import { Button, Spinner } from './ui';
import { DocIcon, ImageIcon, SparkIcon, TextIcon, UploadIcon } from './icons';

type JobProgress = {
  id: string;
  status: 'analyzing' | 'done' | 'error';
};

type Mode = 'files' | 'text';

const SAMPLE = `Supplier update — Summit Ridge Trail Pack 45L
SKU: BG-TRP-45
Colour: Slate Blue
Weight: 1.4 kg
Material: 420D ripstop nylon, DWR coated
Warranty: Limited lifetime
Price: 189.00

Adds a removable hip belt and two ice-axe loops this season.`;

export function IntakePanel({
  onDone,
  onPartial,
}: {
  onDone: (actionIds: string[]) => void;
  /** Called as individual files finish, so the queue fills in progressively. */
  onPartial: () => void;
}) {
  const [mode, setMode] = useState<Mode>('files');
  const [dragging, setDragging] = useState(false);
  /** True only while the upload request is in flight; analysis itself runs in the background. */
  const [busy, setBusy] = useState(false);
  /** Files still being analyzed, across every batch submitted so far. */
  const [inFlight, setInFlight] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Poll /api/jobs until every job in one batch has finished, then hand its actions up.
   * Each batch tracks itself, so the dropzone stays free for the next one.
   */
  const track = useCallback(
    async (queued: { id: string }[]) => {
      const ids = queued.map((j) => j.id).join(',');
      let remaining = queued.length;
      setInFlight((n) => n + remaining);
      const settle = (count: number) => {
        setInFlight((n) => n - count);
        remaining -= count;
      };

      try {
        // Analyses observed at 9-31s each; give a generous ceiling before showing a timeout.
        for (let tick = 0; tick < 400; tick++) {
          await new Promise((r) => setTimeout(r, 1200));
          const res = await fetch(`/api/jobs?ids=${ids}`);
          if (!res.ok) continue;
          const json = (await res.json()) as {
            jobs: JobProgress[];
            done: boolean;
            actionIds: string[];
          };
          const stillRunning = json.jobs.filter((j) => j.status === 'analyzing').length;
          if (stillRunning < remaining) {
            settle(remaining - stillRunning);
            onPartial();
          }
          if (json.done) {
            onDone(json.actionIds);
            return;
          }
        }
        setError('Analysis is taking longer than expected — check the queue in a moment.');
      } finally {
        settle(remaining);
      }
    },
    [onDone, onPartial],
  );

  /** Submit a batch. Resolves once the server has accepted it, not when analysis finishes. */
  const start = useCallback(
    async (body: BodyInit, headers?: HeadersInit): Promise<boolean> => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch('/api/analyze', { method: 'POST', body, headers });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Analysis failed.');
        // Let the queue pick up the new jobs right away — that is what starts its own polling.
        onPartial();
        void track(json.jobs ?? []);
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Analysis failed.');
        return false;
      } finally {
        setBusy(false);
      }
    },
    [onPartial, track],
  );

  const submitFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const body = new FormData();
      files.forEach((f) => body.append('files', f));
      await start(body);
    },
    [start],
  );

  async function submitText() {
    if (!text.trim()) return;
    const ok = await start(JSON.stringify({ text }), { 'Content-Type': 'application/json' });
    if (ok) setText('');
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-bc-line bg-white shadow-sm">
      <header className="flex items-center justify-between gap-4 border-b border-bc-line px-5 py-3.5">
        <div>
          <h2 className="text-sm font-semibold text-bc-ink">Intake</h2>
          <p className="text-xs text-bc-muted">
            Anything with product information — spec sheets, price lists, packshots.
          </p>
        </div>
        <div role="tablist" className="flex rounded-lg bg-bc-surface p-0.5">
          {(
            [
              ['files', 'Upload', UploadIcon],
              ['text', 'Describe', TextIcon],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              role="tab"
              aria-selected={mode === value}
              onClick={() => setMode(value)}
              className={clsx(
                'inline-flex items-center gap-1.5 rounded-[7px] px-3 py-1.5 text-[13px] font-medium transition',
                mode === value
                  ? 'bg-white text-bc-ink shadow-xs'
                  : 'text-bc-muted hover:text-bc-ink',
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          ))}
        </div>
      </header>

      <div className="p-5">
        {mode === 'files' ? (
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void submitFiles([...e.dataTransfer.files]);
            }}
            onClick={() => !busy && inputRef.current?.click()}
            className={clsx(
              'relative grid cursor-pointer place-items-center overflow-hidden rounded-xl',
              'border-2 border-dashed px-6 py-12 text-center transition-colors',
              busy && 'shimmer pointer-events-none',
              dragging
                ? 'border-bc-blue-500 bg-bc-blue-50'
                : 'border-bc-line bg-bc-surface/60 hover:border-bc-blue-300 hover:bg-bc-blue-50/40',
            )}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                void submitFiles([...(e.target.files ?? [])]);
                e.target.value = '';
              }}
            />
            {busy ? (
              <div className="flex flex-col items-center gap-3">
                <Spinner className="size-6 text-bc-blue-500" />
                <p className="text-sm font-medium text-bc-slate">Uploading…</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="flex -space-x-2">
                  {[DocIcon, ImageIcon, UploadIcon].map((Icon, i) => (
                    <div
                      key={i}
                      className="grid size-10 place-items-center rounded-xl border border-bc-line bg-white text-bc-blue-500 shadow-xs"
                      style={{ transform: `rotate(${(i - 1) * 7}deg)` }}
                    >
                      <Icon className="size-5" />
                    </div>
                  ))}
                </div>
                <div>
                  <p className="text-sm font-semibold text-bc-ink">
                    Drop files here, or <span className="text-bc-blue-600">browse</span>
                  </p>
                  <p className="mt-1 text-xs text-bc-muted">
                    PDF · DOCX · CSV · TXT · JPG · PNG · WEBP — multiple files at once
                  </p>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Paste a supplier email, product copy, a spec table — anything describing one or more products."
              rows={9}
              disabled={busy}
              className={clsx(
                'scroll-slim w-full resize-y rounded-xl border border-bc-line bg-bc-surface/60 p-4',
                'font-mono text-[13px] leading-relaxed text-bc-slate placeholder:text-bc-muted/70',
                'transition focus:border-bc-blue-400 focus:bg-white focus:outline-none',
              )}
            />
            <div className="flex items-center justify-between gap-3">
              <button
                onClick={() => setText(SAMPLE)}
                className="text-xs font-medium text-bc-muted underline-offset-2 hover:text-bc-blue-600 hover:underline"
              >
                Insert a sample
              </button>
              <Button variant="primary" onClick={submitText} loading={busy} disabled={!text.trim()}>
                {!busy && <SparkIcon className="size-4" />}
                {busy ? 'Analyzing…' : 'Analyze'}
              </Button>
            </div>
          </div>
        )}

        {inFlight > 0 && (
          <p className="mt-3 flex items-center gap-2 text-xs text-bc-muted">
            <Spinner className="size-3.5 text-bc-blue-500" />
            {inFlight === 1 ? '1 file' : `${inFlight} files`} analyzing on the server — follow
            progress in the action queue below. You can keep adding more.
          </p>
        )}

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-bc-red ring-1 ring-inset ring-red-100">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
